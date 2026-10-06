# AgentCore Browser fleet: API research

Scope: 8 parallel AWS Bedrock AgentCore Browser sessions (ap-southeast-1), driven by Claude through the Bedrock Converse API, with live-view tiles in `apps/web` (Next 16.3.8, React 19.3.0, per `apps/web/package.json`).

Path abbreviations used in the citations below:
- `S/` = `scratchpad/refs/agentcore-samples/use-cases/browser-live-view-agent/` (shallow clone of awslabs/bedrock-agentcore-samples-typescript)
- `P/` = `scratchpad/refs/pkg/package/dist/src/` (`npm pack bedrock-agentcore@0.4.5`)
- `CTL/`, `DP/`, `RT/` = packed `@aws-sdk/client-bedrock-agentcore-control`, `@aws-sdk/client-bedrock-agentcore`, `@aws-sdk/client-bedrock-runtime` (all 3.1146.0) `package/dist-types/`
- scratchpad = `/private/tmp/claude-501/-Users-adityakrx-ombud/db8e4563-317e-4dd6-87ae-2ab7bdf7790a/scratchpad`

## 1. Summary

- `bedrock-agentcore@0.4.5` is the latest version (`npm view bedrock-agentcore versions` ends at 0.4.5). The sample pins `^0.2.2` (`S/package.json:19`). Use 0.4.5.
- Each session gets its own `PlaywrightBrowser` (or base `Browser`) instance. An instance holds exactly one session, and `startSession` throws if one is already active (`P/tools/browser/client.js:61-63`). For a fleet of 8 we need 8 instances.
- The live view is a SigV4-presigned HTTPS URL from `generateLiveViewUrl(expiresIn = 300)` (`P/tools/browser/client.js:300-325`). It is rendered by `<BrowserLiveView signedUrl remoteWidth remoteHeight/>`, which wraps the vendored NICE DCV Web Client SDK and the `dcv-ui` React component. The stream goes from AWS straight to the browser and never passes through our server (`S/README.md:41`).
- Agent loop: the sample uses a plain `ConverseCommand` loop with 6 `toolSpec` tools, runs up to 40 steps, and returns tool output as text (`S/server/agent.ts:44-124, 212-287`).
- Web Bot Auth and recording are not exposed by `bedrock-agentcore`. They are control-plane options on `CreateBrowserCommand` (`browserSigning`, `recording`) in `@aws-sdk/client-bedrock-agentcore-control`. To use them, create a custom browser and pass its `browserId` as `identifier`.
- Quotas (AWS docs, "Quotas for Amazon Bedrock AgentCore"): 1000 concurrent sessions, 30 TPS StartBrowserSession, and **1 live-view stream per session** and 1 automation stream per session. Each session is 1 vCPU / 4 GB. Built-in Tools are available in Asia Pacific (Singapore) (AWS "Supported AWS Regions" page).
- The SDK has no local Playwright fallback. Section 8 proposes a `BrowserProvider` abstraction where both providers return a Playwright `Page`.

## 2. Versions and peer deps

| Package | Version | Source |
|---|---|---|
| bedrock-agentcore | 0.4.5 (latest) | npm |
| @aws-sdk/client-bedrock-runtime | 3.1146.0 (sample `^3.700.0`, `S/package.json:14`) | npm |
| @aws-sdk/client-bedrock-agentcore(-control) | 3.1146.0 (SDK deps `^3.1065.0` / `^3.996.0`) | `P/../../package.json` deps |
| playwright | 1.63.0 latest; SDK peer `>=1.56.0` | peerDependencies |
| node | `>=20.0.0` | engines |

`bedrock-agentcore` 0.4.5 peerDependencies are `react >=18.0.0`, `react-dom >=18.0.0`, `playwright >=1.56.0`, `ai >=6.0.0-beta`, `express`, `@strands-agents/sdk`, and `@a2a-js/sdk`. All of them are marked **optional** in `peerDependenciesMeta`. React 19 meets the declared range.

`dcv-ui.js` imports the following bare packages (from a grep of `P/tools/browser/live-view/nice-dcv-web-client-sdk/dcv-ui/dcv-ui.js`): `react`, `react-dom`, `prop-types`, `dcv`, `@cloudscape-design/components`, `@cloudscape-design/global-styles`, `@cloudscape-design/design-tokens`, `@babel/runtime/helpers/extends`. The SDK does **not** declare these, so the app has to install them. The sample does that in `S/package.json:15-18,22`. Cloudscape components peer is `react >=16.8.0`. The bundled dcv-ui is version 3.20.3.

Subpath exports (package.json `exports`): `bedrock-agentcore/browser`, `/browser/playwright`, `/browser/live-view`, `/browser/vercel-ai`, `/experimental/browser/strands`, `/code-interpreter`, `/runtime`, `/identity`, `/web-search`, plus a few others. **There is no export for the `nice-dcv-web-client-sdk` deep path.** Section 5 explains why that matters for aliasing.

**React 19 verdict: likely compatible, but unverified at runtime.**
- `BrowserLiveView.js` uses only hooks (`P/tools/browser/live-view/BrowserLiveView.js:3`).
- `dcv-ui` uses only `ReactDOM.createPortal` from react-dom (`Q.createPortal` is the only `Q.*` call).
- `defaultProps` appears once, on a class component. React 19 still supports `defaultProps` on classes.
- `propTypes` are present, but React 19 ignores them silently.
- None of the APIs removed in React 19 (`findDOMNode`, `ReactDOM.render`) appear.

Smoke-test this in the first hour.

## 3. Session lifecycle code shapes

### Config (`P/tools/browser/types.d.ts:21-48`)
```ts
interface BrowserClientConfig {
  region?: string            // default process.env.AWS_REGION ?? 'us-west-2' (client.js:41)
  identifier?: string        // default 'aws.browser.v1' (types.d.ts:5)
  credentialsProvider?: AwsCredentialIdentityProvider  // omit => default Node chain
}
```

### StartSessionParams (`types.d.ts:52-80`)
```ts
{ sessionName?: string /* default 'default' */,
  timeout?: number /* seconds, 1-28800, default 3600 -> sent as sessionTimeoutSeconds */,
  viewport?: { width: number; height: number } /* sent as viewPort */,
  proxyConfiguration?, extensions?, profileConfiguration? }
```
In 0.4.5 the SDK parameter is named `timeout`, and the SDK maps it to the wire field `sessionTimeoutSeconds` (`client.js:65,73`). It is not called `sessionTimeoutSeconds` in the SDK API. The sample passes `timeout: 3600` and a 1920x1080 viewport (`S/server/agent.ts:173-177`, `S/server/config.ts:16-20`).

### Classes
- `Browser` (`bedrock-agentcore/browser`, `P/tools/browser/client.d.ts:24-143`):
  - `startSession(p?) => Promise<SessionInfo{sessionName,sessionId,createdAt}>`
  - `attachSession(sessionId): void`. Use this to re-sign live-view URLs for a session that was started elsewhere.
  - `stopSession()`. This is idempotent when no session is active (`client.js:116-118`).
  - `getSession()`, which returns `status`, `sessionTimeoutSeconds`, and `streams`.
  - `listSessions({status:'READY'})`
  - `updateBrowserStream({streamStatus:'ENABLED'|'DISABLED'})`. This toggles the automation stream, which is how a human takes over.
  - `generateLiveViewUrl(expiresIn=300)`
  - `generateWebSocketUrl() => {url, headers}`, the SigV4-signed `wss://bedrock-agentcore.<region>.amazonaws.com/browser-streams/<id>/sessions/<sid>/automation` (`client.js:334-375`).
  - Public readonly fields: `region`, `identifier`.
- `PlaywrightBrowser extends Browser` (`bedrock-agentcore/browser/playwright`, `P/tools/browser/integrations/playwright/client.d.ts:28-146`):
  - Methods: `navigate({url,waitUntil?,timeout?})`, `click({selector})`, `type({selector,text,delay?})`, `fill({selector,value})`, `getText({selector?})`, `getHtml({selector?})`, `screenshot({fullPage?,type?,encoding?:'base64'|'binary'})`, `evaluate({script,args?})`, `back/forward/refresh()`, `getCookies/setCookies`, `pressKey(key)`, `waitForSelector`, `isVisible`.
  - **The Playwright `Page` is private** (`_playwrightPage`, `client.d.ts:30`). There is no public getter.
  - Internally the class calls `chromium.connectOverCDP({endpointURL: ws.url, headers: ws.headers})`, then uses `contexts()[0].pages()[0]`, or `newPage()` if there are no pages (`client.js:294-321`).
  - Any action auto-starts a session if none exists (`client.js:281-289`).
  - `stopSession()` closes the CDP browser first, then calls `StopBrowserSession` (`client.js:42-57`).

### Recommended fleet shape (own the Page)
```ts
import { Browser } from 'bedrock-agentcore/browser'
import { chromium, type Page } from 'playwright'
const b = new Browser({ region: 'ap-southeast-1', identifier })     // one per lane
const s = await b.startSession({ sessionName: `lane-${i}`, timeout: 900, viewport: { width: 1280, height: 800 } })
const ws = await b.generateWebSocketUrl()
const cdp = await chromium.connectOverCDP({ endpointURL: ws.url, headers: ws.headers })
const ctx = cdp.contexts()[0]; const page: Page = ctx.pages()[0] ?? await ctx.newPage()
const liveUrl = await b.generateLiveViewUrl(900)
// teardown: await cdp.close(); await b.stopSession()
```
This mirrors `client.js:294-321` exactly. We get a real `Page` back, which gives us `page.screenshot`, `page.accessibility`, locators, and so on, and it makes the local fallback trivial. Start the 8 sessions with `Promise.all`. That is well under the 30 TPS start quota.

## 4. Converse tool loop shape (`S/server/agent.ts`)

- Client: `new BedrockRuntimeClient({ region, credentials })` (`agent.ts:219-222`). Omit `credentials` to use the default chain.
- Tools: a `ToolConfiguration` built from `{ toolSpec: { name, description, inputSchema: { json: <JSON Schema> } } }` entries (`agent.ts:44-124`). The sample defines `navigate{url}`, `click{selector}`, `type{selector,text}`, `getText{selector?}`, `getHtml{selector?}`, and `pressKey{key}`.
  - `ToolSpecification` also accepts `strict: boolean`.
  - `toolChoice` accepts `auto | any | tool{name}` (`RT/commands/ConverseCommand.d.ts:300-322`).
- Request: `new ConverseCommand({ modelId, system: [{text}], messages, toolConfig })` (`agent.ts:231-238`). Optional fields are `inferenceConfig.maxTokens` and `additionalModelRequestFields` (`ConverseCommand.d.ts:290-328`).
- Loop:
  1. Push `{role:'assistant', content: response.output.message.content}`. The whole content goes back unchanged (`agent.ts:240-241`).
  2. While `response.stopReason === 'tool_use'`, iterate the blocks that have `block.toolUse` (`{toolUseId, name, input}`), execute each one, and collect `{ toolResult: { toolUseId, content: [{ text }] } }`.
  3. Push **all** results in one `{role:'user'}` message (`agent.ts:243-264`).
  4. Otherwise, join the `text` blocks to form the final answer (`agent.ts:266-273`).
- `ToolResultBlock` also supports `content: [{json}|{text}|{image}|{document}]` and `status: 'success'|'error'` (`ConverseCommand.d.ts:107-165`). The sample returns errors as `"Error: ..."` text with no `status` (`agent.ts:153-155`). We should set `status:'error'`.
- `StopReason` values: `end_turn`, `tool_use`, `max_tokens`, `stop_sequence`, `guardrail_intervened`, `content_filtered`, `malformed_model_output`, `malformed_tool_use`, `model_context_window_exceeded` (`RT/models/enums.d.ts:612-622`). Handle `malformed_tool_use` and `max_tokens` explicitly.
- `reasoningContent` blocks can appear in `content` (`ConverseCommand.d.ts:186`). When thinking is on, they must be echoed back unchanged, which the sample already does by pushing the whole content.
- Output is truncated at 4000 characters per tool result (`agent.ts:141,145`). For vision, prefer `screenshot` with an image block: `{ image: { format:'jpeg', source:{ bytes } } }`.
- Model: the sample default is `us.anthropic.claude-opus-4-5-20251101-v1:0` (`S/server/config.ts:14`). **That is a US cross-region inference profile and will not resolve from ap-southeast-1.** Run `aws bedrock list-inference-profiles --region ap-southeast-1` and pick a `global.anthropic.*` or `apac.anthropic.*` profile ID, then set it as `BEDROCK_MODEL_ID`. Do not hand-construct the ID.
- Newer Claude models (the Opus 5.5 / Sonnet 5.5 generation) reject forced tool choice (`any`/`tool`) with a 400, per the Claude API skill notes. Keep `toolChoice` as auto or omit it.

## 5. Live view (server + React)

### Server
- `generateLiveViewUrl(expiresIn)` presigns `GET https://bedrock-agentcore.<region>.amazonaws.com/browser-streams/<identifier>/sessions/<sessionId>/live-view` with SigV4, service `bedrock-agentcore`, credentials in the query string (`client.js:300-325`).
- The endpoint host comes from `getDataPlaneEndpoint` and can be overridden with env `BEDROCK_AGENTCORE_DATA_PLANE_ENDPOINT` (`P/_utils/endpoints.js:22,97-108`).
- **Refresh:** the sample never refreshes the URL. It mints one at start (`agent.ts:180`) and `/api/start` returns the cached copy (`S/server/index.ts:18-24`). With the 300 s default, a page reload after 5 minutes fails to authenticate.
  - Our plan: add an endpoint `GET /api/lanes/:id/live-view` that re-signs on demand. Use `attachSession(sessionId)` on a fresh `Browser` if needed (`client.d.ts:52`).
  - Key the React tile by URL.
  - Use `expiresIn` of about 900 to 3600. The SigV4 maximum is bounded by the lifetime of temporary credentials.
- Session expiry: `timeout` (default 3600 s). Call `stopSession` explicitly, because sessions bill until they time out.

### React (`P/tools/browser/live-view/BrowserLiveView.{d.ts,js}`)
- Exports: `BrowserLiveView`, the `BrowserLiveViewProps` type, and `calculateScale(cw, ch, rw, rh) => {scale, offsetX}` (`live-view/index.d.ts:1-3`).
- Props: `{ signedUrl: string; remoteWidth?: number /*1920*/; remoteHeight?: number /*1080*/ }` (`BrowserLiveView.d.ts:1-8`). Set `remoteWidth`/`remoteHeight` to the session viewport.
- Behaviour:
  - Calls `dcv.authenticate(signedUrl, {success, error, httpExtraSearchParams})` once per URL. Results are cached in a module-level `authStateMap` (`BrowserLiveView.js:7,62-89`).
  - Then renders `<DCVViewer dcv={{ sessionId, authToken, serverUrl: signedUrl, baseUrl: '/nice-dcv-web-client-sdk/dcvjs-esm', divId, ... }} uiConfig={{ toolbar:{visible:false} }}/>` (`:169-181`).
  - The `divId` is unique per instance (`dcv-display-N`, `:22`), so 8 tiles can coexist on one page.
  - Scales with a CSS transform via `ResizeObserver` (`:113-162`).
  - Disconnects on unmount (`:24-32`).
  - Returns `null` until authenticated and renders red text on error (`:164-168`).
  - The parent must give the tile explicit size; the sample uses `aspectRatio` (`S/src/App.tsx:301-305`).
- **The DCV runtime path is hardcoded to `/nice-dcv-web-client-sdk/dcvjs-esm`** (`BrowserLiveView.js:173`). Workers and WASM decoders load from there. Source dir: `node_modules/bedrock-agentcore/dist/src/tools/browser/live-view/nice-dcv-web-client-sdk/{dcvjs-esm,dcv-ui,dcvjs-umd}`; dcvjs-esm is about 2.8 MB.
- Sample wiring (Vite, `S/vite.config.ts:9-46`):
  - `resolve.alias` maps `dcv` to `<sdk>/dcvjs-esm/dcv.js` and `dcv-ui` to `<sdk>/dcv-ui/dcv-ui.js`.
  - `resolve.dedupe` covers react, react-dom, prop-types, cloudscape x3, and @babel/runtime.
  - `viteStaticCopy` copies `dcvjs-esm` and `dcv-ui` into `nice-dcv-web-client-sdk/`.

### Next 16 + pnpm translation
1. `postinstall` script: copy `<sdk>/nice-dcv-web-client-sdk/dcvjs-esm` to `apps/web/public/nice-dcv-web-client-sdk/dcvjs-esm`. Copy EULA.txt and third-party-licenses.txt too; the dcv-ui README asks for them to be served (`dcv-ui/README.md:53-57`).
2. Aliases for the `dcv` and `dcv-ui` bare specifiers:
   - Turbopack (the Next 16 default): `turbopack.resolveAlias`.
   - Webpack: `webpack(config){ config.resolve.alias.dcv = ... }`.
   - Point them at **filesystem** paths, because the package `exports` map blocks deep imports through the package name.
3. Under pnpm, `dcv-ui.js`'s real path is inside `.pnpm/bedrock-agentcore@0.4.5/...`, so its imports of `@cloudscape-design/*`, `prop-types`, and `@babel/runtime` will not resolve to `apps/web` deps. Two ways to fix it:
   - **(a)** Alias those too, or
   - **(b) Recommended:** vendor `dcv.js` and `dcv-ui.js` into `apps/web/vendor/dcv/` and write a ~150-line `LiveViewTile` that ports `BrowserLiveView.js` logic and imports from the vendored files. No aliases are needed and we control refresh and error UI.
4. The component touches `window`, so it must live in a `'use client'` file and be loaded with `next/dynamic(..., { ssr: false })`.
5. `reactStrictMode: true` (`apps/web/next.config.ts`) double-mounts in dev. The SDK survives this because the auth cache is keyed by URL, but expect one disconnect and reconnect.
6. **Only 1 live-view stream per session** (AWS quota). Two browser tabs, or a dashboard plus a projector both showing the same lane, will compete. Plan for one viewer per lane.

## 6. Custom browser + Web Bot Auth + recording (control plane)

`bedrock-agentcore` 0.4.5 has no create-browser API. A grep for signing, webbot, and recording only matches SigV4 and unrelated modules. Use `@aws-sdk/client-bedrock-agentcore-control` instead (`CTL/commands/CreateBrowserCommand.d.ts`):
```ts
import { BedrockAgentCoreControlClient, CreateBrowserCommand, GetBrowserCommand } from '@aws-sdk/client-bedrock-agentcore-control'
const ctl = new BedrockAgentCoreControlClient({ region: 'ap-southeast-1' })
const r = await ctl.send(new CreateBrowserCommand({
  name: 'overpaid_fleet',                         // required
  description: 'Overpaid fleet browser',
  networkConfiguration: { networkMode: 'PUBLIC' },  // 'PUBLIC' | 'VPC'
  executionRoleArn: 'arn:aws:iam::<acct>:role/<role>',
  browserSigning: { enabled: true },              // Web Bot Auth (Preview)
  recording: { enabled: true, s3Location: { bucket: '<b>', prefix: 'browser-recordings/' } },
  clientToken, tags,
}))
// r.browserId, r.browserArn, r.status: CREATING|CREATE_FAILED|READY|DELETING|DELETE_FAILED|DELETED
// poll GetBrowserCommand until READY, then new Browser({ identifier: r.browserId, region })
```
- Type sources: `BrowserSigningConfigInput { enabled: boolean }` (`CTL/models/models_0.d.ts:2602-2608`), and `recording?: RecordingConfig` with `browserSigning?` on the request (`:2857-2865`).
- Other fields: `enterprisePolicies`, `certificates` (Secrets Manager), and `filesystemConfigurations` (S3 Files/EFS).
- From the AWS "Reducing CAPTCHAs with Web Bot Auth" doc:
  - The feature is **Preview** and based on an IETF draft.
  - It requires an execution role whose trust policy lets `bedrock-agentcore.amazonaws.com` call `sts:AssumeRole` (with `aws:SourceAccount` and `aws:SourceArn` conditions). No permission policies are needed for signing alone.
  - It must be enabled at creation time.
  - Requests get the `Signature`, `Signature-Input`, and `Signature-Agent` headers.
  - Vendors: Cloudflare, HUMAN, Akamai, DataDome, F5.
  - The system browser `aws.browser.v1` cannot be configured, so signing and recording need a custom browser.
  - Recording also needs S3 write permission on the execution role.
- CreateBrowser is limited to 5 TPS. Create the browser once in `infra/` and store the `browserId` in env (`BROWSER_IDENTIFIER`, as in `S/server/config.ts:17`).

## 7. Credentials and IAM

- Credential resolution:
  - `Browser` passes `credentialsProvider` to `BedrockAgentCoreClient` if one is set. Otherwise it uses the SDK default chain (`client.js:43-47`).
  - The SigV4 signing for live view and automation uses `this._credentialsProvider ?? fromNodeProviderChain()` (`client.js:306,344`).
  - So the env vars, `AWS_PROFILE`/SSO, container, and instance roles all work.
  - The sample's `config.ts` **force-requires** static env keys and exits otherwise (`S/server/config.ts:7-11,28-34`). Do not copy that. Instead, omit `credentials` and probe with `fromNodeProviderChain()()` to decide AgentCore vs local (section 8).
- Region: pass `region: 'ap-southeast-1'` explicitly. The SDK default is `us-west-2` (`types.d.ts:17`).
- IAM policy (from the AWS "Get started with AgentCore Browser" doc):
```json
{ "Effect": "Allow", "Action": [
  "bedrock-agentcore:StartBrowserSession", "bedrock-agentcore:StopBrowserSession",
  "bedrock-agentcore:GetBrowserSession", "bedrock-agentcore:ListBrowserSessions",
  "bedrock-agentcore:UpdateBrowserStream",
  "bedrock-agentcore:ConnectBrowserAutomationStream", "bedrock-agentcore:ConnectBrowserLiveViewStream",
  "bedrock-agentcore:CreateBrowser", "bedrock-agentcore:GetBrowser",
  "bedrock-agentcore:ListBrowsers", "bedrock-agentcore:DeleteBrowser"],
  "Resource": "arn:aws:bedrock-agentcore:<region>:<acct>:browser/*" },
{ "Effect": "Allow", "Action": ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"], "Resource": "*" }
```
  - Converse requires `bedrock:InvokeModel` (`RT/commands/ConverseCommand.d.ts:27`).
  - The AWS-owned `aws.browser.v1` may not match `<acct>:browser/*`. For the hackathon, use `Resource: "*"` on the bedrock-agentcore statement, or test both forms.
  - Add `iam:PassRole` on the execution role for CreateBrowser.
  - Cross-region inference profiles (`global.`/`apac.`) need InvokeModel on both the profile ARN and the foundation-model ARNs in each routed region, which is why the statement uses `"*"`.

## 8. Local fallback design (no AWS creds)

The SDK has no fallback. `_connectPlaywright` always calls AgentCore (`client.js:294-305`). Design:

```ts
// packages/shared/src/browser/provider.ts
export interface LiveView { kind: 'dcv'; url: string; width: number; height: number }
                         | { kind: 'frames'; streamPath: string; width: number; height: number }
export interface LaneSession {
  id: string; page: import('playwright').Page;
  liveView(): Promise<LiveView>;          // re-mintable (DCV URL refresh / frames endpoint)
  stop(): Promise<void>;
}
export interface BrowserProvider { kind: 'agentcore' | 'local'; start(o: { lane: number; viewport: {width:number;height:number}; timeoutSec: number }): Promise<LaneSession> }
```
- `AgentCoreProvider.start`: follows section 3 (`Browser`, then `startSession`, `generateWebSocketUrl`, `connectOverCDP`). `liveView()` returns `{kind:'dcv', url: await b.generateLiveViewUrl(900)}`, and `stop` calls `cdp.close()` then `b.stopSession()`.
- `LocalProvider.start`:
  - Launch one `chromium.launch({ headless: true })` shared by all lanes. Each lane gets `browser.newContext({ viewport })` and then `newPage()`.
  - For the live view, open a CDP session per page with `ctx.newCDPSession(page)` and call `Page.startScreencast({format:'jpeg', quality:60, maxWidth:640, everyNthFrame:2})`. Ack each frame with `Page.screencastFrameAck`.
  - Push frames over SSE or WebSocket from a route (`/api/lanes/:id/frames`). The tile renders them into an `<img>`/`<canvas>`.
  - A simpler fallback is to poll `page.screenshot({type:'jpeg', quality:50})` about every 500 ms.
  - Needs `npx playwright install chromium`.
- Tool executor: `executeTool(page: Page, name, input)`. It is identical for both providers because it uses only the Playwright `Page` API (the sample's tools map 1:1: `page.goto`, `page.click`, `page.fill`/`type`, `page.textContent('body')`, `page.content()`, `page.keyboard.press`). The Converse loop never knows which provider is underneath.
- Selection: if `process.env.BROWSER_PROVIDER` is set, use it. Otherwise call `fromNodeProviderChain()()` and fall back to `local` if it throws. Bedrock Converse itself still needs AWS creds. When no creds are present, the model side also needs a fallback, for example the Anthropic API via `@anthropic-ai/sdk` behind the same message/tool adapter, or recorded replays for the demo. Keep the `ModelClient` interface separate from `BrowserProvider`.
- UI: `<LaneTile view={LiveView}/>` switches on `kind` and renders either the DCV tile (dynamic, `ssr:false`) or the frame tile.

## 9. Gotchas

1. One instance holds one session (`client.js:61`), so the fleet needs 8 `Browser` instances with distinct `sessionName`s.
2. The live-view URL expires after 300 s by default, and the sample never refreshes it (`client.js:300`, `S/server/index.ts:19-21`).
3. Only **1 live-view stream and 1 automation stream per session**. A second viewer, or a second `connectOverCDP`, will conflict. If the server restarts, reconnecting needs the old CDP connection to be gone.
4. The DCV assets path is hardcoded (`BrowserLiveView.js:173`), so it must be served from `public/`. The deep SDK path is not in the `exports` map, so alias by filesystem path or vendor the files.
5. pnpm plus the vendored `dcv-ui.js` means Cloudscape, prop-types, and @babel/runtime imports will not resolve from the SDK's real path. Install them in `apps/web` and alias or vendor (section 5, item 3).
6. SSR: the DCV code needs `window`, so use `dynamic(..., {ssr:false})`.
7. The `PlaywrightBrowser` `Page` is private. Use base `Browser` and your own `connectOverCDP` for full control.
8. Any `PlaywrightBrowser` action **auto-starts** a session if none exists (`client.js:283-285`). A stray call after `stopSession` silently creates a new billed session.
9. The sample's model ID is US-only (`config.ts:14`). Use an ap-southeast-1-valid `global.`/`apac.` profile.
10. The sample hard-fails without static env keys (`config.ts:28-34`). Use the default chain instead.
11. Return tool errors with `status:'error'`, and put all `toolResult`s for one turn in a single user message (`agent.ts:243-264` already does the latter).
12. The `remoteWidth`/`remoteHeight` props must equal the session `viewport`, or scaling and the display-layout lock are wrong (`BrowserLiveView.js:99-107`). For 8 tiles, a smaller viewport such as 1280x800 cuts DCV bandwidth.
13. Each session is limited to 1 vCPU / 4 GB, so heavy pages are slow. Use `waitUntil:'domcontentloaded'` (the SDK default, `playwright/client.js:70`).
14. Web Bot Auth is Preview, works only with a custom browser created at creation time, and only helps on Cloudflare, HUMAN, Akamai, DataDome, and F5 protected sites.
15. The `vercel-ai` integration (`BrowserTools`, `createNavigateTool`, `createClickTool`, `createTypeTool`, `createGetTextTool`, `createGetHtmlTool`, `createScreenshotTool`, `createEvaluateTool`, per `P/tools/browser/integrations/vercel-ai/index.d.ts:11-18`) needs `ai >=6`. It does not apply to a Converse loop, so skip it.
