// Screen specs: original Necta screen as the base, text regions patched, Ombud text drawn on top.
// Coordinates are in source-image pixels, measured with bands.js / region.js.
const WHITE = '#ffffff';
const GRAY = '#8d8e8f';

const home = {
  name: 'home',
  base: 'L2ARBl5VjbPwVVKk1UIHigZww.png',
  w: 860,
  h: 1864,
  patches: [
    { x: 148, y: 112, w: 560, h: 90, interp: true },
    { x: 40, y: 292, w: 440, h: 40, interp: true },
    { x: 40, y: 338, w: 600, h: 92, interp: true },
    { x: 84, y: 532, w: 210, h: 38, clone: { dy: 60 } },
    { x: 84, y: 722, w: 640, h: 48, clone: { dy: -55 } },
    { x: 84, y: 790, w: 210, h: 32, clone: { dy: -100 } },
    { x: 630, y: 790, w: 90, h: 34, clone: { dy: -100 } },
    { x: 40, y: 945, w: 420, h: 56, interp: true },
    { x: 50, y: 1120, w: 770, h: 66, interp: true },
    { x: 40, y: 1248, w: 400, h: 56, interp: true },
    { x: 300, y: 1388, w: 520, h: 190, interp: true },
  ],
  texts: [
    { t: 'Hello Adi,', x: 153, base: 154, fs: 43, wt: 600 },
    { t: 'Welcome back', x: 151, base: 194, fs: 28, wt: 400 },
    { t: 'Money on the table', x: 45, base: 325, fs: 36, wt: 400, c: GRAY },
    { t: '$1,284.60', x: 44, base: 412, fs: 80, wt: 600 },
    { t: 'Recovered so far', x: 90, base: 562, fs: 32, wt: 500, c: '#3c3736' },
    { t: '$412.60', x: 91, base: 762, fs: 46, wt: 500, c: '#3c3736', ls: 0.04 },
    { t: '8 vigils running', x: 90, base: 815, fs: 27, wt: 500, c: '#3c3736' },
    { t: 'Oct 26', x: 706, base: 815, fs: 27, wt: 500, c: '#3c3736', align: 'right' },
    { t: 'Vigils', x: 46, base: 985, fs: 47, wt: 600 },
    { t: 'Cancel', x: 113, base: 1148, fs: 27, align: 'center' },
    { t: 'plans', x: 113, base: 1179, fs: 27, align: 'center' },
    { t: 'Refunds', x: 271, base: 1148, fs: 27, align: 'center' },
    { t: 'Price', x: 428, base: 1148, fs: 27, align: 'center' },
    { t: 'drops', x: 428, base: 1179, fs: 27, align: 'center' },
    { t: 'Claims', x: 586, base: 1148, fs: 27, align: 'center' },
    { t: 'Join', x: 744, base: 1148, fs: 27, align: 'center' },
    { t: 'blocs', x: 744, base: 1179, fs: 27, align: 'center' },
    { t: 'Recent Recoveries', x: 46, base: 1289, fs: 47, wt: 600 },
    { t: 'Your agents are', x: 322, base: 1425, fs: 41, wt: 400 },
    { t: 'working on it', x: 320, base: 1466, fs: 41, wt: 400 },
    { t: 'Recoveries will appear', x: 322, base: 1530, fs: 33, wt: 400, c: GRAY },
    { t: 'here', x: 322, base: 1563, fs: 33, wt: 400, c: GRAY },
  ],
};


// Subscriptions list (1152 wide). Shared layout for the bloc screen below.
const SUB_ROWS = [668, 865, 1061, 1258, 1455];
const SUB_BASE = [713, 910, 1106, 1303, 1500];
function listScreen(name, title, label, headline, rows) {
  const patches = [
    { x: 60, y: 338, w: 640, h: 70 },
    { x: 60, y: 428, w: 900, h: 95 },
  ];
  const texts = [
    { t: label, x: 66, base: 389, fs: 58, c: '#828282' },
    { t: headline, x: 66, base: 501, fs: 80, wt: 500 },
  ];
  if (title) {
    patches.push({ x: 300, y: 125, w: 560, h: 76 });
    texts.push({ t: title, x: 575, base: 182, fs: 62, wt: 500, align: 'center' });
  }
  rows.forEach(([n, v], i) => {
    patches.push({ x: 140, y: SUB_ROWS[i] - 8, w: 460, h: 74 });
    patches.push({ x: 640, y: SUB_ROWS[i] - 8, w: 460, h: 76 });
    texts.push({ t: n, x: 150, base: SUB_BASE[i], fs: 60, c: '#828282' });
    texts.push({ t: v, x: 1082, base: SUB_BASE[i], fs: 62, wt: 600, align: 'right' });
  });
  return { name, base: 'Tl0tmkSzbRhIyDIQR9UvFN2Asns.png', w: 1152, h: 2496, patches, texts };
}

const subs = listScreen('subs', null, 'Unused subscriptions', '$57 a month', [
  ['Vistaflix 4K', '$22.99/month'],
  ['Vistaflix Basic', '$9.99/month'],
  ['Tunewave', '$10.99/month'],
  ['Cloudcrate', '$2.99/month'],
  ['FitPulse Pro', '$119/year'],
]);

const bloc = listScreen('bloc', 'eSIM Bloc', 'Pledged demand', '128 members', [
  ['NomadLink bid', '$9.80/GB'],
  ['RoamFox bid', '$11.20/GB'],
  ['Orbit eSIM bid', '$12.40/GB'],
  ['Your max', '$15.00/GB'],
  ['You save', '$5.20/GB'],
]);

// Analytics -> Recoveries (860 wide).
const DAY_TOPS = [330, 446, 562, 678, 794, 910, 1026];
const recoveries = {
  name: 'recoveries',
  base: 'LkKZRZFRJ9x7P8v6mWq7TqzQMpE.png',
  w: 860,
  h: 1864,
  patches: [
    { x: 290, y: 92, w: 280, h: 62 },
    { x: 44, y: 208, w: 240, h: 36 },
    ...DAY_TOPS.map((y) => ({ x: 46, y: y - 3, w: 46, h: 30, interp: true })),
    { x: 44, y: 1163, w: 496, h: 44, interp: true },
    { x: 44, y: 1218, w: 340, h: 92, interp: true },
    { x: 105, y: 1366, w: 330, h: 380 },
    { x: 500, y: 1366, w: 320, h: 380 },
  ],
  texts: [
    { t: 'Recoveries', x: 429, base: 136, fs: 49, wt: 500, align: 'center' },
    { t: '6 October', x: 50, base: 238, fs: 33, c: '#848383' },
    ...['7', '8', '9', '10', '11', '12', '13'].map((d, i) => ({ t: d, x: 50, base: DAY_TOPS[i] + 23, fs: 32, c: '#848383' })),
    { t: 'Recovered This Week', x: 51, base: 1202, fs: 45, c: '#848383' },
    { html: '$412<span style="font-size:0.62em">.60</span>', x: 49, base: 1292, fs: 82, wt: 600 },
    ...[
      ['Subscriptions', '+$156.97'],
      ['Refunds', '+$129.98'],
      ['Price drops', '+$64.50'],
      ['Flight claim', '+$61.15'],
    ].flatMap(([n, v], i) => [
      { t: n, x: 114, base: [1407, 1513, 1618, 1724][i], fs: 44, c: '#848383' },
      { t: v, x: 809, base: [1407, 1513, 1618, 1724][i], fs: 48, wt: 600, align: 'right' },
    ]),
  ],
};

// Money Saved -> Money Recovered (860 wide).
const recovered = {
  name: 'recovered',
  base: 'jeA9oLuuQC5PeFvaHe3XyUdLBuQ.png',
  w: 860,
  h: 1864,
  patches: [
    { x: 200, y: 106, w: 480, h: 64 },
    { x: 250, y: 256, w: 360, h: 36 },
    { x: 180, y: 304, w: 500, h: 110 },
    { x: 150, y: 1074, w: 560, h: 44 },
  ],
  texts: [
    { t: 'Money Recovered', x: 436, base: 151, fs: 50, wt: 500, align: 'center' },
    { t: 'Total Recovered', x: 428, base: 286, fs: 32, c: '#908f8f', align: 'center' },
    { t: '$1,284', x: 428, base: 389, fs: 96, wt: 700, align: 'center' },
    { t: 'Every claim comes with evidence', x: 429, base: 1105, fs: 33, c: '#807f80', align: 'center' },
  ],
};

// ReadyCash Loan -> Specialist (860 wide).
const specialist = {
  name: 'specialist',
  base: 'RDLGfQoLZ4wHsOjAtl8EAsRBUw.png',
  w: 860,
  h: 1864,
  patches: [
    { x: 150, y: 524, w: 560, h: 66 },
    { x: 196, y: 618, w: 466, h: 46, fill: '#000' },
    { x: 300, y: 776, w: 260, h: 76, fill: 'rgb(25,25,25)' },
    { x: 280, y: 1088, w: 300, h: 52, fill: 'rgb(229,189,231)' },
  ],
  texts: [
    { t: 'AirClaim Specialist', x: 429, base: 571, fs: 52, wt: 700, align: 'center' },
    { t: 'masumi · airline claims', x: 429, base: 652, fs: 32, c: '#c9c7c9', align: 'center' },
    { t: '2 USDM', x: 429, base: 832, fs: 60, wt: 700, align: 'center' },
    { t: 'Lock in escrow', x: 429, base: 1127, fs: 40, wt: 600, c: '#000', align: 'center' },
  ],
};

// Send Money -> Hire Specialist (1292 wide).
const hire = {
  name: 'hire',
  base: 'Odf5LdFIZbIGiAudJQVeXBm0K8.png',
  w: 1292,
  h: 2796,
  patches: [
    { x: 380, y: 122, w: 650, h: 78 },
    { x: 300, y: 718, w: 700, h: 64 },
    { x: 300, y: 796, w: 700, h: 50 },
    { x: 250, y: 960, w: 800, h: 114 },
    { x: 360, y: 1224, w: 96, h: 42, fill: 'rgb(51,51,51)' },
    { x: 590, y: 1224, w: 100, h: 42, fill: 'rgb(207,112,210)' },
    { x: 826, y: 1224, w: 100, h: 42, fill: 'rgb(51,51,51)' },
    { x: 60, y: 1520, w: 500, h: 64 },
    { x: 80, y: 1690, w: 560, h: 125, fill: 'rgb(51,51,51)' },
    { x: 400, y: 2550, w: 500, h: 70, fill: 'rgb(244,167,250)' },
  ],
  extra: '<div style="position:absolute;left:84px;top:1702px;width:106px;height:106px;border-radius:50%;background:#0033ad;display:flex;align-items:center;justify-content:center;font:600 62px/1 Poppins;color:#fff">₳</div>',
  texts: [
    { t: 'Hire Specialist', x: 702, base: 175, fs: 60, wt: 500, font: 'Poppins', align: 'center' },
    { t: 'AirClaim Agent', x: 643, base: 775, fs: 64, wt: 600, font: 'Poppins', align: 'center' },
    { t: 'Masumi · airline claims', x: 642, base: 838, fs: 46, font: 'Poppins', align: 'center' },
    { t: '2.00 USDM', x: 640, base: 1050, fs: 96, wt: 700, font: 'Poppins', align: 'center' },
    { t: 'ADA', x: 406, base: 1259, fs: 40, font: 'Poppins', align: 'center' },
    { t: 'USDM', x: 640, base: 1259, fs: 40, font: 'Poppins', c: '#000', align: 'center' },
    { t: 'tADA', x: 876, base: 1259, fs: 40, font: 'Poppins', align: 'center' },
    { t: 'Pay From', x: 71, base: 1576, fs: 64, wt: 500, font: 'Poppins' },
    { t: 'Cardano wallet', x: 250, base: 1773, fs: 46, wt: 500, font: 'Poppins' },
    { t: 'Lock 2 USDM in escrow', x: 645, base: 2602, fs: 52, wt: 500, font: 'Poppins', c: '#000', align: 'center' },
  ],
};

// Recent Transaction -> Recent Recoveries (1292 wide).
const REC = [
  ['V', '#e5484d', 'Vistaflix', 'Cancelled · Today, 11:48 AM', '+$22.99'],
  ['C', '#3e63dd', 'Cartwell', 'Price drop · 6 Oct, 10:12 AM', '+$64.50'],
  ['S', '#12a594', 'Skylane Air', 'Claim paid · 5 Oct, 4:30 PM', '+$61.15'],
  ['P', '#f76b15', 'Parcelia', 'Refund · 3 Oct, 9:05 AM', '+$38.40'],
  ['C', '#3e63dd', 'Cartwell', 'Duplicate charge · 1 Oct', '+$49.99'],
];
const NAME_TOP = [264, 496, 728, 963, 1198];
const DATE_TOP = [332, 563, 795, 1031, 1263];
const AMT_TOP = [286, 518, 750, 985, 1223];
const recent = {
  name: 'recent',
  base: 'MZuZ4SW1gLsee35cHQW4z8kwKDc.png',
  w: 1292,
  h: 2796,
  patches: [
    { x: 55, y: 100, w: 700, h: 76 },
    ...NAME_TOP.flatMap((y, i) => [
      { x: 52, y: y - 24, w: 148, h: 148 },
      { x: 232, y: y - 8, w: 640, h: DATE_TOP[i] - y + 50 },
      { x: 900, y: AMT_TOP[i] - 8, w: 340, h: 62 },
    ]),
  ],
  extra: REC.map(([l, c], i) => `<div style="position:absolute;left:59px;top:${NAME_TOP[i] - 20}px;width:132px;height:132px;border-radius:50%;background:${c};display:flex;align-items:center;justify-content:center;font:600 60px/1 Poppins;color:#fff">${l}</div>`).join(''),
  texts: [
    { t: 'Recent Recoveries', x: 65, base: 163, fs: 66, wt: 500, font: 'Poppins' },
    ...REC.flatMap(([, , n, d, a], i) => [
      { t: n, x: 241, base: NAME_TOP[i] + 37, fs: 48, wt: 500, font: 'Poppins' },
      { t: d, x: 240, base: DATE_TOP[i] + 26, fs: 33, font: 'Poppins', c: '#8e8e93' },
      { t: a, x: 1228, base: AMT_TOP[i] + 37, fs: 46, font: 'Poppins', c: '#7fd8a4', align: 'right' },
    ]),
  ],
};

// Card-in-hand onboarding (1292 wide): only the bottom copy changes.
const onboard = {
  name: 'onboard',
  base: 'mmAjTnZaQhlLrtHcl6B5XwX7yI.png',
  w: 1292,
  h: 2796,
  patches: [
    { x: 60, y: 1955, w: 1172, h: 110 },
    { x: 150, y: 2130, w: 1000, h: 140 },
  ],
  texts: [
    { t: 'Money Back, Simple Way', x: 631, base: 2034, fs: 86, wt: 600, align: 'center' },
    { t: 'Your Agent Finds It, Claims It', x: 646, base: 2174, fs: 46, c: '#f2f2f2', align: 'center' },
    { t: '& Shows You The Proof', x: 648, base: 2246, fs: 46, c: '#f2f2f2', align: 'center' },
  ],
};

// onboard is not used: on the site that screen is cropped above its copy, which is drawn over the hand photo.
module.exports = [home, subs, bloc, recoveries, recovered, specialist, hire, recent];
