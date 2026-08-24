// ══════════════════════════════════ AUTH / LOGIN ══════════════════════════════════
// Real auth: netlify/functions/auth.js verifies credentials server-side and sets a
// signed, HttpOnly session cookie. netlify/functions/sheet-store.js verifies that
// cookie on every request and rejects anything without a valid session — the login
// screen is a real gate now, not just a UI hint.

let currentUser = null;

async function attemptLogin(){
  const submitBtn = document.getElementById('login-submit-btn');
  if(submitBtn && submitBtn.disabled) return;

  const uEl = document.getElementById('login-username');
  const pEl = document.getElementById('login-password');
  const errEl = document.getElementById('login-error');

  const u = (uEl.value || '').trim();
  const p = pEl.value || '';

  // Clear previous error
  errEl.textContent = '';

  if(!u || !p){
    errEl.textContent = 'Please enter username and password.';
    return;
  }

  if(submitBtn) submitBtn.disabled = true;

  try {
    const res = await fetch('/.netlify/functions/auth', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      credentials: 'include',
      body: JSON.stringify({
        username: u,
        password: p
      })
    });

    const result = await res.json();

    if(!res.ok){
      errEl.textContent = result.error || 'Invalid username or password.';
      if(submitBtn) submitBtn.disabled = false;
      return;
    }

    currentUser = {
      username: result.username,
      role: result.role,
      displayName: result.displayName || result.username
    };

    await enterApp();

  } catch(error) {
    console.error('Login error:', error);
    errEl.textContent = 'Unable to connect to the login server. Please try again.';
  } finally {
    if(submitBtn) submitBtn.disabled = false;
  }
}

async function logoutUser(){
  currentUser = null;

  // Clear the server-side session cookie so it can't be reused after logout.
  try{
    await fetch('/.netlify/functions/logout', {
      method: 'POST',
      credentials: 'include'
    });
  }catch(e){
    console.warn(
      'Logout request failed (cookie may still be valid until it expires):',
      e
    );
  }

  // Wipe sensitive data from memory too, not just from the screen.
  cabins = buildDefaultCabins();
  occupants = [];
  payments = [];
  invoices = [];
  leads = [];
  quotations = [];
  virtualOffice = [];
  documents = defaultDocuments();
  appSettings = Object.assign({}, DEFAULT_SETTINGS);

  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('login-username').value = '';
  document.getElementById('login-password').value = '';
  document.getElementById('login-error').textContent = '';
  document.getElementById('login-username').focus();
}

async function enterApp(){
  document.getElementById('login-screen').classList.add('hidden');

  document.getElementById('sf-username').textContent =
    currentUser.displayName;

  const badge = document.getElementById('sf-role-badge');

  badge.textContent =
    currentUser.role === 'admin' ? 'ADMIN' : 'STAFF';

  badge.className =
    'role-badge ' +
    (currentUser.role === 'admin' ? 'admin' : 'staff');

  applyRolePermissions();

  // The pre-login sync (see INIT at the bottom of this file) ran without a session
  // cookie, so sheet-store.js rejected it and every table came back empty. Now that
  // we have a valid session, pull the real data. syncAllFromSheets() calls
  // refreshAll() itself once the data lands, so we don't need to call it separately.

  if(typeof syncAllFromSheets === 'function')
    await syncAllFromSheets();
  else if(typeof refreshAll === 'function')
    refreshAll();
}

function applyRolePermissions(){
  const isAdmin =
    currentUser && currentUser.role === 'admin';

  document.querySelectorAll('.admin-only-nav').forEach(el=>{
    el.classList.toggle('staff-only-hide', !isAdmin);
  });

  // If a staff user is somehow on a restricted page,
  // bounce them to the dashboard.
  if(!isAdmin){
    const restricted = ['revenue','datasync'];

    const activePage =
      document.querySelector('.page.active');

    if(
      activePage &&
      restricted.includes(
        activePage.id.replace('page-','')
      )
    ){
      showPage(
        'dashboard',
        document.querySelector('.nav-item')
      );
    }
  }
}

function checkAuthOnLoad(){
  // Login is never remembered across page loads —
  // always start at the login screen.
  currentUser = null;

  document
    .getElementById('login-screen')
    .classList.remove('hidden');
}


// ══════════════════════════════════ DATA MODEL ══════════════════════════════════

const RATE_PER_SEAT = 8000;
// Default reference rate (₹ + GST per seat).
// Individual occupant rent remains editable and is never
// overwritten by this default.

const PARKING_RATE = 5000;

const FLOORS = [
  'First Floor',
  'Second Floor',
  'Third Floor'
];

function genRegularFloor(prefix, cprefix){
  const seats = [
    6,3,3,3,3,5,5,2,10,10,10,10
  ];

  const arr = seats.map((s,i)=>({
    id:prefix+(i+1),
    seater:s
  }));

  for(let i=1;i<=6;i++)
    arr.push({
      id:cprefix+i,
      seater:1
    });

  return arr;
}

const FLOOR_LAYOUT = {

  'First Floor': [
    {id:'F1', seater:5},
    {
      id:'F2/F3',
      seater:7,
      note:'Merged conference-style cabin'
    },
    {id:'F4', seater:3},
    {id:'F5', seater:3},
    {id:'F6', seater:2},
    {id:'F7', seater:10},
    {id:'F8', seater:10},
    {id:'F9', seater:10},

    {id:'FC1', seater:1},
    {id:'FC2', seater:1},
    {id:'FC3', seater:1},
    {id:'FC4', seater:1},
    {id:'FC5', seater:1},
    {id:'FC6', seater:1},
    {id:'FC7', seater:1},
    {id:'FC8', seater:1},
    {id:'FC9', seater:1},
    {id:'FC10', seater:1},
    {id:'FC11', seater:1},
  ],

  'Second Floor':
    genRegularFloor('S','SC'),

  'Third Floor':
    genRegularFloor('T','TC')
};

const SEED_OCCUPIED = [];

function buildDefaultCabins(){

  const cabins = [];

  FLOORS.forEach(floor=>{

    FLOOR_LAYOUT[floor].forEach((c,idx)=>{

      cabins.push({
        id: c.id,
        floor,
        seater: c.seater,
        sno: idx+1,

        occupied:
          SEED_OCCUPIED.includes(c.id),

        occupantId: null,
        occupantName: null,

        note: c.note || ''
      });

    });

  });

  return cabins;
}


// All persistent data now lives in Google Sheets only
// (no localStorage). These start as safe in-memory defaults
// and are overwritten by syncAllFromSheets() once the initial
// load from Sheets completes.

let cabins = buildDefaultCabins();

let occupants = null;

let virtualOffice = [];

let documents = null;

let payments = [];

let invoices = [];

let leads = [];

let quotations = [];

let appSettings = {};


// ══════════════════════════════════ SHEETS SYNC ══════════════════════════════════

async function loadFromSheet(name){

  try{

    const res = await fetch(
      '/.netlify/functions/sheet-store?sheet=' +
      encodeURIComponent(name),
      {
        credentials:'include'
      }
    );

    if(!res.ok){
      console.warn(
        'Sheet load failed:',
        name,
        res.status
      );

      return [];
    }

    const data = await res.json();

    return Array.isArray(data)
      ? data
      : (data.rows || []);

  }catch(e){

    console.error(
      'Sheet load error:',
      name,
      e
    );

    return [];
  }
}


async function syncToSheet(name,data){

  try{

    const res = await fetch(
      '/.netlify/functions/sheet-store',
      {
        method:'POST',

        headers:{
          'Content-Type':'application/json'
        },

        credentials:'include',

        body:JSON.stringify({
          sheet:name,
          rows:data
        })
      }
    );

    if(!res.ok){

      const txt =
        await res.text().catch(()=>'');

      console.error(
        'Sheet save failed:',
        name,
        res.status,
        txt
      );

      return false;
    }

    return true;

  }catch(e){

    console.error(
      'Sheet save error:',
      name,
      e
    );

    return false;
  }
}


async function syncAllFromSheets(){

  const [
    c,
    o,
    p,
    inv,
    l,
    q,
    vo,
    d,
    s
  ] = await Promise.all([

    loadFromSheet('cabins'),

    loadFromSheet('occupants'),

    loadFromSheet('payments'),

    loadFromSheet('invoices'),

    loadFromSheet('leads'),

    loadFromSheet('quotations'),

    loadFromSheet('virtual_office'),

    loadFromSheet('documents'),

    loadFromSheet('settings')

  ]);

  if(c && c.length)
    cabins = c;

  occupants =
    (o && o.length)
      ? o
      : [];

  if(p && p.length)
    payments = p;

  if(inv && inv.length)
    invoices = inv;

  if(l && l.length)
    leads = l;

  if(q && q.length)
    quotations = q;

  if(vo && vo.length)
    virtualOffice = vo;

  documents =
    (d && d.length)
      ? d
      : defaultDocuments();

  appSettings =
    (
      s &&
      s.length &&
      s[0]
    )
      ? Object.assign(
          {},
          DEFAULT_SETTINGS,
          s[0]
        )
      : Object.assign(
          {},
          DEFAULT_SETTINGS
        );

  applyTheme(
    appSettings.theme || 'dark'
  );

  if(typeof refreshAll === 'function')
    refreshAll();
}


function saveCabins(){
  syncToSheet(
    'cabins',
    cabins
  );
}

function saveOccupants(){
  syncToSheet(
    'occupants',
    occupants
  );
}

function saveVirtualOffice(){
  syncToSheet(
    'virtual_office',
    virtualOffice
  );
}

function saveDocuments(){

  const oversized =
    documents.filter(
      d =>
        d.dataUrl &&
        d.dataUrl.length >
        SHEETS_CELL_LIMIT
    );

  const syncable =
    documents.filter(
      d =>
        !d.dataUrl ||
        d.dataUrl.length <=
        SHEETS_CELL_LIMIT
    );

  if(oversized.length){

    console.warn(
      'Some documents are too large for a Google Sheets cell and will only persist for this browser session:',
      oversized.map(d=>d.name)
    );

  }

  syncToSheet(
    'documents',
    syncable
  );
}


// ---- Payments ledger ----

function savePayments(){
  syncToSheet(
    'payments',
    payments
  );
}


// ---- Invoices ----

function saveInvoices(){
  syncToSheet(
    'invoices',
    invoices
  );

}


// ---- Sales CRM: leads, activities, quotations ----

const LEAD_STAGES = [
  'New',
  'Contacted',
  'Follow-up',
  'Quotation Sent',
  'Negotiation',
  'Converted',
  'Lost'
];

const LEAD_SOURCES = [
  'Cold Call',
  'Instagram',
  'Facebook',
  'Google',
  'LinkedIn',
  'WhatsApp',
  'Website',
  'Agency',
  'Justdial',
  'Referral',
  'Walk-in',
  'Other'
];

function saveLeads(){
  syncToSheet(
    'leads',
    leads
  );
}

function saveQuotations(){

  syncToSheet(
    'quotations',
    quotations
  );

}


// ══════════════════════════════════ GLOBAL UI STATE ══════════════════════════════════

let floorCurrent = 'First Floor';

let floorFilter = 'all';

let addFloorFilter = 'all';

let addAvailOnly = true;

let selectedAddCabinIds = new Set();

let alertTabCurrent = 'all';

let docFilterCurrent = 'All';


// ══════════════════════════════════ HELPERS ══════════════════════════════════

function today(){

  return new Date()
    .toISOString()
    .slice(0,10);

}

function daysLeft(endDate){

  if(!endDate)
    return null;

  const end =
    new Date(
      endDate + 'T00:00:00'
    );

  const now =
    new Date();

  now.setHours(
    0,0,0,0
  );

  return Math.ceil(
    (end-now) /
    86400000
  );

}

function getDaysFromToday(date){

  return daysLeft(date);

}

function fmtINR(n){

  return '₹' +
    Number(n || 0)
      .toLocaleString('en-IN');

}

function fmtDate(v){

  if(!v)
    return '—';

  const d =
    new Date(
      v + 'T00:00:00'
    );

  if(isNaN(d))
    return v;

  return d.toLocaleDateString(
    'en-IN',
    {
      day:'2-digit',
      month:'short',
      year:'numeric'
    }
  );

}

function fmtDateDDMMYY(v){

  if(!v)
    return '';

  const d =
    new Date(
      v + 'T00:00:00'
    );

  if(isNaN(d))
    return v;

  return [
    String(d.getDate())
      .padStart(2,'0'),

    String(
      d.getMonth()+1
    ).padStart(2,'0'),

    String(
      d.getFullYear()
    ).slice(-2)

  ].join('.');

}

function esc(value){

  return String(
    value ?? ''
  )
  .replace(/&/g,'&amp;')
  .replace(/</g,'&lt;')
  .replace(/>/g,'&gt;')
  .replace(/"/g,'&quot;')
  .replace(/'/g,'&#039;');

}

function parseNum(v){

  const n =
    parseFloat(
      String(v ?? '')
        .replace(/,/g,'')
        .replace(/[₹]/g,'')
    );

  return Number.isFinite(n)
    ? n
    : 0;

}

function safeArray(v){

  return Array.isArray(v)
    ? v
    : [];

}

function formatMonthLabel(month){

  if(!month)
    return '';

  const parts =
    month.split('-');

  if(parts.length !== 2)
    return month;

  const d =
    new Date(
      Number(parts[0]),
      Number(parts[1])-1,
      1
    );

  return d.toLocaleDateString(
    'en-IN',
    {
      month:'long',
      year:'numeric'
    }
  );

}

function monthKey(d){

  return d.toISOString()
    .slice(0,7);

}

function parseLocalDate(v){

  return new Date(
    v + 'T00:00:00'
  );

}

function addMonths(date,months){

  const d =
    new Date(date);

  d.setMonth(
    d.getMonth()+months
  );

  return d;

}

function clamp(v,min,max){

  return Math.max(
    min,
    Math.min(max,v)
  );

}

function downloadBlob(
  blob,
  filename
){

  const url =
    URL.createObjectURL(blob);

  const a =
    document.createElement('a');

  a.href = url;

  a.download =
    filename;

  document.body.appendChild(a);

  a.click();

  a.remove();

  setTimeout(
    ()=>URL.revokeObjectURL(url),
    1000
  );

}

function copyText(text){

  if(
    navigator.clipboard &&
    navigator.clipboard.writeText
  ){

    navigator.clipboard
      .writeText(text)
      .then(
        ()=>alert(
          'Copied to clipboard.'
        )
      )
      .catch(
        ()=>alert(
          'Could not copy — please select and copy manually.'
        )
      );

  }else{

    alert(
      'Clipboard not available in this browser.'
    );

  }

}


// ══════════════════════════════════ THEME ══════════════════════════════════

function initTheme(){

  const saved =
    localStorage.getItem(
      'collabor8-theme'
    );

  applyTheme(
    saved || 'dark'
  );

}

function applyTheme(theme){

  document.documentElement
    .setAttribute(
      'data-theme',
      theme
    );

  const icon =
    document.getElementById(
      'theme-toggle-icon'
    );

  const label =
    document.getElementById(
      'theme-toggle-label'
    );

  if(icon)
    icon.textContent =
      theme === 'dark'
        ? '☾'
        : '☀';

  if(label)
    label.textContent =
      theme === 'dark'
        ? 'Dark mode'
        : 'Light mode';

}

function toggleTheme(){

  const current =
    document.documentElement
      .getAttribute(
        'data-theme'
      ) || 'dark';

  const next =
    current === 'dark'
      ? 'light'
      : 'dark';

  applyTheme(next);

  localStorage.setItem(
    'collabor8-theme',
    next
  );

  if(typeof saveSettings === 'function')
    saveSettings();

}


// ══════════════════════════════════ SETTINGS ══════════════════════════════════

const DEFAULT_SETTINGS = {

  theme:'dark',

  paymentLink:'',

  upiId:'',

  payeeName:'COLLABOR8'

};

function saveSettings(){

  appSettings =
    Object.assign(
      {},
      DEFAULT_SETTINGS,
      appSettings
    );

  syncToSheet(
    'settings',
    [appSettings]
  );

}

function getPaymentLink(){

  return appSettings.paymentLink || '';

}

function setPaymentLink(v){

  appSettings.paymentLink =
    v || '';

  saveSettings();

}

function getUpiId(){

  return appSettings.upiId || '';

}

function setUpiId(v){

  appSettings.upiId =
    v || '';

  saveSettings();

}

function getPayeeName(){

  return appSettings.payeeName ||
    'COLLABOR8';

}

function setPayeeName(v){

  appSettings.payeeName =
    v || '';

  saveSettings();

}

function initPaymentLinkField(){

  const a =
    document.getElementById(
      'payment-link-input'
    );

  if(a)
    a.value =
      getPaymentLink();

  const b =
    document.getElementById(
      'upi-id-input'
    );

  if(b)
    b.value =
      getUpiId();

  const c =
    document.getElementById(
      'upi-payee-input'
    );

  if(c)
    c.value =
      getPayeeName();

}

function savePaymentSettings(){

  setPaymentLink(
    document.getElementById(
      'payment-link-input'
    ).value.trim()
  );

  setUpiId(
    document.getElementById(
      'upi-id-input'
    ).value.trim()
  );

  setPayeeName(
    document.getElementById(
      'upi-payee-input'
    ).value.trim()
  );

  const note =
    document.getElementById(
      'payment-link-note'
    );

  if(note){

    note.textContent =
      '✓ Saved';

    setTimeout(
      ()=>{
        if(
          note.textContent ===
          '✓ Saved'
        ){
          note.textContent =
            '';
        }
      },
      2000
    );

  }

}


// ══════════════════════════════════ PAYMENT LINKS ══════════════════════════════════

function buildPaymentLink(
  occ,
  amountRs,
  note
){

  const vpa =
    (occ && occ.upiId) ||
    getUpiId();

  if(vpa){

    return 'upi://pay?' +
      'pa=' +
      encodeURIComponent(vpa) +
      '&pn=' +
      encodeURIComponent(
        getPayeeName()
      ) +
      '&am=' +
      encodeURIComponent(
        amountRs
      ) +
      '&cu=INR' +
      '&tn=' +
      encodeURIComponent(
        note || ''
      );

  }

  return getPaymentLink();

}

function paymentLinkBlock(
  occ,
  amountRs,
  note
){

  const link =
    buildPaymentLink(
      occ,
      amountRs,
      note
    );

  if(!link)
    return '';

  const isUpi =
    link.indexOf(
      'upi://'
    ) === 0;

  return isUpi

    ? `\nPay via UPI (₹${amountRs.toLocaleString('en-IN')}): ${link}\n(Open this link on your phone with GPay, PhonePe, Paytm or any UPI app to pay this exact amount instantly.)`

    : `\nPay online: ${link}`;

}
