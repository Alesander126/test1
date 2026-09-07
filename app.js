/* global supabase, ZXingBrowser */
const cfg = window.APP_CONFIG || {};
const configured = cfg.SUPABASE_URL && !cfg.SUPABASE_URL.includes('PASTE_') && cfg.SUPABASE_PUBLISHABLE_KEY && !cfg.SUPABASE_PUBLISHABLE_KEY.includes('PASTE_');
const db = configured ? supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_PUBLISHABLE_KEY) : null;

const $ = (id) => document.getElementById(id);
const screens = ['configScreen','loginScreen','appScreen'];
let currentProfile = null;
let scanResolve = null;
let scannerControls = null;

function showScreen(id){screens.forEach(x=>$(x).classList.toggle('hidden',x!==id));}
function toast(msg){const el=$('toast');el.textContent=msg;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),2600);}
function esc(v=''){return String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
function qty(v){const n=Number(v);return Number.isFinite(n)?n:0;}
function setView(name){document.querySelectorAll('.view').forEach(v=>v.classList.add('hidden'));$(name+'View').classList.remove('hidden');document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active',t.dataset.view===name));if(name==='history') loadHistory();}

async function init(){
  if(!configured){showScreen('configScreen');return;}
  const {data:{session}}=await db.auth.getSession();
  if(session) await enterApp(); else showScreen('loginScreen');
  db.auth.onAuthStateChange(async (_e,session)=>{if(session) await enterApp(); else showScreen('loginScreen');});
  if('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(console.warn);
}

async function enterApp(){
  const {data:{user}}=await db.auth.getUser();
  if(!user){showScreen('loginScreen');return;}
  const {data,error}=await db.from('profiles').select('id,full_name,role').eq('id',user.id).maybeSingle();
  if(error) console.error(error);
  currentProfile=data||{id:user.id,full_name:user.email,role:'worker'};
  $('userLabel').textContent=`${currentProfile.full_name||user.email} · ${currentProfile.role}`;
  showScreen('appScreen');setView('home');
}

$('loginForm').addEventListener('submit',async e=>{e.preventDefault();$('loginError').textContent='';const {error}=await db.auth.signInWithPassword({email:$('loginEmail').value.trim(),password:$('loginPassword').value});if(error)$('loginError').textContent=error.message;});
$('logoutBtn').onclick=()=>db.auth.signOut();
document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.view)));
document.querySelectorAll('[data-action]').forEach(b=>b.addEventListener('click',()=>renderOperation(b.dataset.action)));

async function scanCode(){
  $('manualScanInput').value='';$('scannerDialog').showModal();
  return new Promise(async resolve=>{
    scanResolve=resolve;
    try{
      const reader=new ZXingBrowser.BrowserMultiFormatReader();
      scannerControls=await reader.decodeFromConstraints({video:{facingMode:{ideal:'environment'}}},$('scannerVideo'),(result)=>{if(result) finishScan(result.getText());});
    }catch(err){console.warn(err);toast('Kamera niedostępna — wpisz kod ręcznie.');}
  });
}
function finishScan(value){if(!scanResolve)return;try{scannerControls?.stop();}catch{}scannerControls=null;$('scannerDialog').close();const r=scanResolve;scanResolve=null;r(String(value).trim());}
$('closeScannerBtn').onclick=()=>finishScan('');
$('manualScanBtn').onclick=()=>finishScan($('manualScanInput').value);

function renderOperation(type){
  const labels={place:['Umieść produkt','Dodaje ilość produktu do lokalizacji.'],move:['Przenieś produkt','Przenosi ilość między lokalizacjami.'],pick:['Zdejmij ze stanu','Zmniejsza ilość produktu w lokalizacji.']};
  const [title,desc]=labels[type];
  $('operationPanel').classList.remove('hidden');
  $('operationPanel').innerHTML=`<h2>${title}</h2><p class="muted">${desc}</p><div class="op-grid">
    <label>SKU / EAN<div class="row gap"><input id="opProduct" placeholder="zeskanuj lub wpisz"><button id="scanProduct" class="btn">📷</button></div></label>
    ${type==='move'?'<label>Lokalizacja źródłowa<div class="row gap"><input id="opFrom" placeholder="np. A-R01-P03"><button id="scanFrom" class="btn">📷</button></div></label>':''}
    <label>${type==='pick'?'Lokalizacja':'Lokalizacja docelowa'}<div class="row gap"><input id="opTo" placeholder="np. A-R01-P03"><button id="scanTo" class="btn">📷</button></div></label>
    <label>Ilość<input id="opQty" class="qty" type="number" min="0.001" step="0.001" value="1"></label>
    <div id="opInfo" class="op-status muted">Zeskanuj produkt i lokalizację.</div>
    <button id="opSave" class="btn primary full">Zapisz operację</button></div>`;
  $('scanProduct').onclick=async()=>{const c=await scanCode();if(c){$('opProduct').value=c;await previewProduct(c);}};
  if($('scanFrom'))$('scanFrom').onclick=async()=>{const c=await scanCode();if(c)$('opFrom').value=c;};
  $('scanTo').onclick=async()=>{const c=await scanCode();if(c)$('opTo').value=c;};
  $('opProduct').addEventListener('change',()=>previewProduct($('opProduct').value));
  $('opSave').onclick=()=>saveOperation(type);
}

async function previewProduct(code){const {data}=await db.from('products').select('sku,name,barcode').or(`sku.eq.${code},barcode.eq.${code}`).maybeSingle();$('opInfo').innerHTML=data?`<b>${esc(data.name)}</b><br>SKU: ${esc(data.sku)}`:'Nie znaleziono produktu. Najpierw dodaj go w bazie.';}
async function resolveProduct(code){const {data,error}=await db.from('products').select('id,sku,name').or(`sku.eq.${code},barcode.eq.${code}`).maybeSingle();if(error)throw error;if(!data)throw new Error('Nie znaleziono produktu: '+code);return data;}
async function resolveLocation(code){const {data,error}=await db.from('locations').select('id,code,name').eq('code',code).maybeSingle();if(error)throw error;if(!data)throw new Error('Nie znaleziono lokalizacji: '+code);return data;}

async function saveOperation(type){
  try{
    const amount=qty($('opQty').value);if(amount<=0)throw new Error('Ilość musi być większa od 0.');
    const product=await resolveProduct($('opProduct').value.trim());
    if(type==='place'){
      const to=await resolveLocation($('opTo').value.trim());
      const {error}=await db.rpc('place_product',{p_product_id:product.id,p_location_id:to.id,p_quantity:amount});if(error)throw error;
    }else if(type==='move'){
      const from=await resolveLocation($('opFrom').value.trim()),to=await resolveLocation($('opTo').value.trim());
      const {error}=await db.rpc('move_product',{p_product_id:product.id,p_from_location_id:from.id,p_to_location_id:to.id,p_quantity:amount});if(error)throw error;
    }else{
      const from=await resolveLocation($('opTo').value.trim());
      const {error}=await db.rpc('pick_product',{p_product_id:product.id,p_location_id:from.id,p_quantity:amount});if(error)throw error;
    }
    toast('Operacja zapisana ✓');renderOperation(type);
  }catch(err){toast(err.message||String(err));}
}

$('scanSearchBtn').onclick=async()=>{const c=await scanCode();if(c){$('searchInput').value=c;searchProducts();}};
$('searchBtn').onclick=searchProducts;
$('searchInput').addEventListener('keydown',e=>{if(e.key==='Enter')searchProducts();});
async function searchProducts(){
  const q=$('searchInput').value.trim();if(!q)return;
  const {data,error}=await db.from('products').select('id,sku,barcode,name,manufacturer').or(`sku.ilike.%${q}%,barcode.ilike.%${q}%,name.ilike.%${q}%`).limit(30);
  if(error){toast(error.message);return;}
  const wrap=$('searchResults');wrap.innerHTML='';
  if(!data?.length){wrap.innerHTML='<div class="card muted">Brak wyników.</div>';return;}
  for(const p of data){
    const [{data:stock},{data:ci}]=await Promise.all([
      db.from('stock_view').select('location_code,location_name,quantity').eq('product_id',p.id),
      db.from('container_stock_view').select('container_code,location_code,quantity').eq('product_id',p.id)
    ]);
    const total=[...(stock||[]),...(ci||[])].reduce((s,x)=>s+qty(x.quantity),0);
    const el=document.createElement('div');el.className='result-card';
    el.innerHTML=`<h3>${esc(p.name)}</h3><span class="badge">SKU ${esc(p.sku)}</span> <span class="badge">Razem ${total}</span><p class="muted">${esc(p.manufacturer||'')}</p>${(stock||[]).map(x=>`<div class="stock-row"><span>${esc(x.location_code)} ${esc(x.location_name||'')}</span><b>${x.quantity}</b></div>`).join('')}${(ci||[]).map(x=>`<div class="stock-row"><span>📦 ${esc(x.container_code)} → ${esc(x.location_code||'bez lokalizacji')}</span><b>${x.quantity}</b></div>`).join('')}`;
    wrap.appendChild(el);
  }
}

$('generateContainerBtn').onclick=()=>{$('containerCode').value='OZ-'+new Date().toISOString().replace(/\D/g,'').slice(2,14);};
$('createContainerBtn').onclick=openContainer;
async function openContainer(){
  try{
    const code=$('containerCode').value.trim();if(!code)throw new Error('Podaj kod OZ.');
    let {data:c,error}=await db.from('containers').select('id,code,status,location_id,locations(code,name)').eq('code',code).maybeSingle();if(error)throw error;
    if(!c){const r=await db.rpc('create_container',{p_code:code});if(r.error)throw r.error;c={id:r.data,code,status:'open',locations:null};}
    renderContainer(c);await loadContainerItems(c.id);
  }catch(err){toast(err.message||String(err));}
}
function renderContainer(c){$('containerWorkspace').innerHTML=`<div class="card"><h2>📦 ${esc(c.code)}</h2><p id="ozLocation" class="muted">Lokalizacja: ${esc(c.locations?.code||'brak')}</p><label>Dodaj produkt<div class="row gap"><input id="ozProduct" class="grow" placeholder="SKU / EAN"><button id="ozScanProduct" class="btn">📷</button></div></label><label>Ilość<input id="ozQty" type="number" min="0.001" step="0.001" value="1"></label><button id="ozAdd" class="btn primary full">Dodaj do OZ</button><hr><label>Umieść całe OZ<div class="row gap"><input id="ozLoc" class="grow" placeholder="kod lokalizacji"><button id="ozScanLoc" class="btn">📷</button></div></label><button id="ozPlace" class="btn full">Przypisz OZ do lokalizacji</button></div><div id="ozItems" class="results"></div>`;
  $('ozScanProduct').onclick=async()=>{const x=await scanCode();if(x)$('ozProduct').value=x;};
  $('ozScanLoc').onclick=async()=>{const x=await scanCode();if(x)$('ozLoc').value=x;};
  $('ozAdd').onclick=async()=>{try{const p=await resolveProduct($('ozProduct').value.trim());const q=qty($('ozQty').value);const {error}=await db.rpc('add_product_to_container',{p_container_id:c.id,p_product_id:p.id,p_quantity:q});if(error)throw error;toast('Dodano do OZ');$('ozProduct').value='';await loadContainerItems(c.id);}catch(e){toast(e.message||String(e));}};
  $('ozPlace').onclick=async()=>{try{const l=await resolveLocation($('ozLoc').value.trim());const {error}=await db.rpc('place_container',{p_container_id:c.id,p_location_id:l.id});if(error)throw error;$('ozLocation').textContent='Lokalizacja: '+l.code;toast('OZ umieszczone ✓');}catch(e){toast(e.message||String(e));}};
}
async function loadContainerItems(id){const {data,error}=await db.from('container_items').select('quantity,products(sku,name)').eq('container_id',id);if(error){toast(error.message);return;}$('ozItems').innerHTML=(data||[]).map(x=>`<div class="result-card"><b>${esc(x.products?.name)}</b><div class="stock-row"><span>SKU ${esc(x.products?.sku)}</span><b>${x.quantity}</b></div></div>`).join('')||'<div class="card muted">OZ jest puste.</div>';}

$('refreshHistoryBtn').onclick=loadHistory;
async function loadHistory(){const {data,error}=await db.from('movement_view').select('*').order('created_at',{ascending:false}).limit(50);if(error){toast(error.message);return;}$('historyResults').innerHTML=(data||[]).map(x=>`<div class="result-card"><div class="row" style="justify-content:space-between"><b>${esc(x.operation)}</b><span class="badge">${x.quantity}</span></div><p>${esc(x.product_name||x.container_code||'')}</p><small class="muted">${esc(x.from_location_code||'—')} → ${esc(x.to_location_code||'—')} · ${new Date(x.created_at).toLocaleString('pl-PL')} · ${esc(x.actor_name||'')}</small></div>`).join('')||'<div class="card muted">Brak operacji.</div>';}

init();
