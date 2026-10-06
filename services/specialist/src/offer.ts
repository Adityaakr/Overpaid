/**
 * The paid x402 route: `POST /x402/start_job`, masumi method, payTo = Masumi vested_pay v2 escrow, price in tADA.
 * @x402/cardano's server scheme issues a fresh seller-signed quote per 402 (terms + CIP-8 signature +
 * blockchainIdentifier), committing input_hash to the exact JSON job body. The facilitator runs in-process with no keys.
 */
import { x402HTTPResourceServer, x402ResourceServer, type FacilitatorClient, type HTTPTransportContext } from '@x402/core/server';
import { ExactCardanoScheme as ServerScheme } from '@x402/cardano/exact/server';
import type { MasumiSellerSigner, MasumiTermsStorage } from '@x402/cardano';
import { ESCROW_ADDRESS, NETWORK, SPECIALIST_PAID_PATH } from '@overpaid/cardano';
import type { SpecialistConfig } from './config.js';
import { JobBody } from './jobs.js';

export interface Offer {
  path: string;
  resource: string;
  http: x402HTTPResourceServer;
  server: x402ResourceServer;
}

export async function makeOffer(cfg: SpecialistConfig, deps: { seller: MasumiSellerSigner; facilitator: FacilitatorClient; storage?: MasumiTermsStorage; log?: (m: string) => void }): Promise<Offer> {
  const server = new x402ResourceServer(deps.facilitator).register(
    NETWORK,
    new ServerScheme({
      ...(deps.storage ? { masumiStorage: deps.storage } : {}),
      masumi: {
        seller: deps.seller,
        ...(cfg.agentIdentifier ? { agentIdentifier: cfg.agentIdentifier } : {}),
        deadlines: cfg.deadlines,
        // input_hash commits to the job body. It was validated before the gate, so parse() cannot fail here.
        commitment: ({ transportContext }) => {
          const body = JobBody.parse((transportContext as HTTPTransportContext).request.adapter.getBody?.());
          return [{ name: 'body', canonicalization: 'jcs', mediaType: 'application/json', content: body }];
        },
      },
    }),
  );
  server.onVerifyFailure(async ({ error }) => deps.log?.(`[x402 verify] ${error.message}`));
  server.onSettleFailure(async ({ error }) => deps.log?.(`[x402 settle] ${error.message}`));
  const resource = `${cfg.publicUrl}${SPECIALIST_PAID_PATH}`;
  const http = new x402HTTPResourceServer(server, {
    [`POST ${SPECIALIST_PAID_PATH}`]: {
      resource,
      accepts: {
        scheme: 'exact',
        network: NETWORK,
        payTo: ESCROW_ADDRESS,
        maxTimeoutSeconds: cfg.maxTimeoutSeconds,
        price: { amount: cfg.priceLovelace.toString(), asset: 'lovelace' },
        extra: { assetTransferMethod: 'masumi', areFeesSponsored: false, confirmationPolicy: { l1Confirmations: cfg.l1Confirmations } },
      },
      description: 'Airline delay compensation claim (Skylane Air demo), first-party Overpaid specialist. Fee held in Masumi escrow; priced in tADA on preprod.',
      mimeType: 'application/json',
    },
  });
  await server.initialize();
  await http.initialize();
  return { path: SPECIALIST_PAID_PATH, resource, http, server };
}
