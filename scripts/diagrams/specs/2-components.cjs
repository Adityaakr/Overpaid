// Every service, its port, which keys it holds, and what it talks to (docs/ARCHITECTURE.md).
module.exports = {
  name: 'components',
  w: 1360,
  h: 800,
  titles: [{ x: 40, y: 34, text: 'Components and keys' }],
  boxes: [
    { id: 'web', x: 40, y: 330, w: 220, h: 110, color: 'yellow', text: ['apps/web :3000', '/app screens, /join', 'CIP-30 wallet signs', 'pledges and fees'] },

    { id: 'find', x: 340, y: 90, w: 220, h: 80, color: 'green', text: ['packages/find', 'parsers, recurring, detectors'] },
    { id: 'api', x: 340, y: 320, w: 220, h: 130, color: 'blue', text: ['services/api :4000', 'orchestrator, ledger, SSE', 'write guard + operator token', 'holds seed B (buyer)'] },
    { id: 'db', x: 340, y: 560, w: 220, h: 70, color: 'gray', text: ['Postgres', 'Drizzle schema'] },

    { id: 'fleet', x: 650, y: 70, w: 240, h: 96, color: 'blue', text: ['services/fleet :4500', 'Claude tool loop', 'no keys, no payment tools'] },
    { id: 'spec', x: 650, y: 230, w: 240, h: 96, color: 'blue', text: ['services/specialist :4200', 'MIP-003 + x402 masumi seller', 'holds seed S only'] },
    { id: 'bloc', x: 650, y: 400, w: 240, h: 96, color: 'blue', text: ['services/bloc :4300', 'campaigns, pledges, settle', 'auto-refund after deadline'] },
    { id: 'prov', x: 650, y: 570, w: 240, h: 80, color: 'gray', text: ['services/providers :4400', 'signed bids (simulated)'] },

    { id: 'merch', x: 990, y: 40, w: 300, h: 70, color: 'gray', text: ['services/merchants :4101-4104', 'four demo merchant sites'] },
    { id: 'model', x: 990, y: 140, w: 300, h: 70, color: 'teal', text: ['Claude', 'OpenRouter, Bedrock or Anthropic API'] },
    { id: 'escrow', x: 990, y: 260, w: 300, h: 80, color: 'red', text: ['Masumi vested_pay v2 escrow', 'Cardano preprod'] },
    { id: 'aiken', x: 990, y: 410, w: 300, h: 80, color: 'red', text: ['Aiken bloc validator', 'withdraw-zero settlement'] },
    { id: 'bf', x: 990, y: 560, w: 300, h: 70, color: 'gray', text: ['Blockfrost', 'chain reads + tx submit'] },
  ],
  arrows: [
    { from: 'web', to: 'api', label: 'REST + SSE' },
    { from: 'api', to: 'find' },
    { from: 'api', to: 'db' },
    { from: 'api', to: 'fleet', label: 'tasks, approvals' },
    { from: 'api', to: 'spec', label: 'x402 pay', dy: 14 },
    { from: 'api', to: 'bloc', label: 'build, merge, submit', dy: 16 },
    { from: 'prov', to: 'bloc', label: 'bids' },
    { from: 'fleet', to: 'merch' },
    { from: 'fleet', to: 'model' },
    { from: 'spec', to: 'escrow', label: 'result, collect' },
    { from: 'bloc', to: 'aiken' },
    { points: [[1140, 496], [1140, 554]] },
  ],
  notes: [
    { x: 40, y: 700, lines: ['Seed A (treasury, bloc admin) never runs on a tunnelled host. Seed C holds the labelled custodial demo wallets.', 'Users sign their own pledges and fees in their wallet; the server only merges witnesses into the body it built.'] },
  ],
};
