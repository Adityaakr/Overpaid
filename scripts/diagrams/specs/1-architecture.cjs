// Overview used by the README and docs/IMPLEMENTATION.md.
const R = 730, P = 1060;
module.exports = {
  name: 'architecture',
  w: 1340,
  h: 770,
  titles: [
    { x: 40, y: 30, text: 'Sokosumi Coworker: hired and paid per Task' },
    { x: 40, y: 410, text: 'Overpaid app: find, fix, hire, bargain' },
  ],
  boxes: [
    { id: 'team', x: 40, y: 110, w: 210, h: 96, color: 'yellow', text: ['Finance / eng team', 'creates a Task', 'on Sokosumi'] },
    { id: 'worker', x: 330, y: 110, w: 220, h: 96, color: 'blue', text: ['Coworker worker', 'services/coworker', 'one run per Task'] },
    { id: 'find', x: R, y: 50, w: 240, h: 86, color: 'green', text: ['Find engine + Claude', 'sourced findings,', 'drafted messages'] },
    { id: 'vendor', x: R, y: 170, w: 240, h: 96, color: 'green', text: ['Vendor admin APIs', 'read token -> proposal', 'write token after approval'] },
    { id: 'mps', x: P, y: 110, w: 240, h: 96, color: 'violet', text: ['Masumi payment service', 'signed terms,', 'result hash, collection'] },
    { id: 'chain', x: P, y: 260, w: 240, h: 80, color: 'red', text: ['Cardano preprod', 'escrow - result - payout'] },

    { id: 'app', x: 40, y: 480, w: 210, h: 96, color: 'yellow', text: ['Overpaid web app', 'Find - Fix - Hire - Bloc', 'users sign with CIP-30'] },
    { id: 'fleet', x: 330, y: 430, w: 220, h: 80, color: 'blue', text: ['Browser fleet', 'no keys, no payments'] },
    { id: 'merchants', x: R, y: 435, w: 240, h: 70, color: 'gray', text: ['Merchant sites', '(demo merchants today)'] },
    { id: 'spec', x: 330, y: 550, w: 220, h: 80, color: 'blue', text: ['Specialist agent', 'paid over x402 masumi'] },
    { id: 'escrow', x: R, y: 550, w: 240, h: 80, color: 'red', text: ['Masumi escrow', 'refund if no result'] },
    { id: 'bloc', x: 330, y: 670, w: 220, h: 70, color: 'blue', text: ['Bloc service', 'pledges + settlement'] },
    { id: 'aiken', x: R, y: 670, w: 240, h: 70, color: 'red', text: ['Aiken bloc contract', 'members pledge from own wallet'] },
  ],
  arrows: [
    { from: 'team', to: 'worker', label: 'Task' },
    { from: 'worker', to: 'find' },
    { from: 'worker', to: 'vendor' },
    { from: 'worker', to: 'mps', label: 'terms, result hash' },
    { from: 'mps', to: 'chain' },
    { points: [[145, 212], [145, 305], [850, 305], [850, 272]], label: 'approve in the Task thread', dashed: true, labelAt: [500, 328] },
    { from: 'app', to: 'fleet' },
    { from: 'fleet', to: 'merchants', label: 'approve irreversible step' },
    { from: 'app', to: 'spec' },
    { from: 'spec', to: 'escrow', label: 'lock - result - collect' },
    { from: 'app', to: 'bloc' },
    { from: 'bloc', to: 'aiken', label: 'pledge - settle - refund' },
  ],
};
