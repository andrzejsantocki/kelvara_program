import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import { announcementRegistryFromEnv, createKaminoInspector, createKaminoMonitorServer, evaluateAdminRollovers, KAMINO } from "../subapps/kamino-monitor/server.js";

const WALLET = "883AnESJiUVzCnwowgaWCpXp4EGsK4JMVzUUUcjSSs62";
const AUTHORITY = KAMINO.expectedUpgradeAuthority;
const VAULT_ADMIN = "9ceRgz579BcfWogs3RE11FKNQaWW7Lmtnev3MXspxUjF";
const ALLOCATION_ADMIN = "CuEC7JoZtHx9v5MQWrNTsLSGMEixbCEvTX6K6kWZzz7q";
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function decode58(value){let n=0n;for(const c of value)n=n*58n+BigInt(ALPHABET.indexOf(c));const out=[];while(n){out.push(Number(n%256n));n/=256n}out.reverse();let leading=0;while(value[leading]==="1")leading++;return Buffer.from([...new Array(leading).fill(0),...out])}
function programDataBytes(authority=AUTHORITY){const data=Buffer.alloc(45);data.writeUInt32LE(3,0);data.writeBigUInt64LE(432874668n,4);data[12]=1;decode58(authority).copy(data,13);return data}
function programBytes(){const data=Buffer.alloc(36);data.writeUInt32LE(2,0);decode58(KAMINO.programData).copy(data,4);return data}
function vaultStateBytes({vaultAdmin=VAULT_ADMIN,pendingAdmin=VAULT_ADMIN,allocationAdmin=ALLOCATION_ADMIN}={}){const data=Buffer.alloc(62552);Buffer.from("e4c452a562d2eb98","hex").copy(data,0);decode58(vaultAdmin).copy(data,8);decode58(pendingAdmin).copy(data,58448);decode58(allocationAdmin).copy(data,58648);return data}
function fixtureFetch({authority=AUTHORITY,shares="100",rate="1.070707005112529878",vaultState={}}={}){return async (url,options={})=>{
 const body=options.body&&JSON.parse(options.body);
 let value;
 if(String(url).includes("/positions")) value=[{vaultAddress:KAMINO.vault,stakedShares:shares,unstakedShares:"0",totalShares:shares}];
 else if(String(url).includes("/metrics")) value={tokensPerShare:rate,apy7d:"0.073"};
 else if(body?.params?.[0]===KAMINO.program) value={context:{slot:10},value:{owner:KAMINO.loader,data:[programBytes().toString("base64"),"base64"],executable:true}};
 else if(body?.params?.[0]===KAMINO.programData) value={context:{slot:11},value:{owner:KAMINO.loader,data:[programDataBytes(authority).toString("base64"),"base64"],executable:false}};
 else if(body?.params?.[0]===KAMINO.vault) value={context:{slot:12},value:{owner:KAMINO.program,data:[vaultStateBytes(vaultState).toString("base64"),"base64"],executable:false}};
 else throw new Error(`unexpected:${url}`);
 return {ok:true,status:200,json:async()=>String(url).includes("rpc")?{result:value}:value};
}}

test("control plane verifies every effective admin against approved baselines",async()=>{
 const inspector=createKaminoInspector({fetchImpl:fixtureFetch(),rpcUrl:"https://rpc",expectedVaultAdmin:VAULT_ADMIN,expectedPendingAdmin:VAULT_ADMIN,expectedAllocationAdmin:ALLOCATION_ADMIN});
 const control=await inspector.inspectControlPlane();
 assert.equal(control.adminRights.ruleId,"kamino-kvault-effective-admin-rights");
 assert.equal(control.adminRights.result,"pass");
 assert.deepEqual(control.adminRights.authorities.vaultAdmin,{current:VAULT_ADMIN,expected:VAULT_ADMIN,matches:true});
 assert.deepEqual(control.adminRights.authorities.pendingAdmin,{current:VAULT_ADMIN,expected:VAULT_ADMIN,matches:true});
 assert.deepEqual(control.adminRights.authorities.allocationAdmin,{current:ALLOCATION_ADMIN,expected:ALLOCATION_ADMIN,matches:true});
 assert.deepEqual(control.adminRights.authorities.programUpgrade,{current:AUTHORITY,expected:AUTHORITY,matches:true});
 assert.equal(control.adminRights.slot,12);
});

test("invalid vault-state evidence is unknown, never healthy",async()=>{
 const fetchImpl=fixtureFetch();const wrapped=async(url,options={})=>{const response=await fetchImpl(url,options),body=options.body&&JSON.parse(options.body);if(body?.params?.[0]!==KAMINO.vault)return response;const payload=await response.json();payload.result.value.owner="11111111111111111111111111111111";return{...response,json:async()=>payload}};
 const control=await createKaminoInspector({fetchImpl:wrapped,rpcUrl:"https://rpc",expectedVaultAdmin:VAULT_ADMIN,expectedPendingAdmin:VAULT_ADMIN,expectedAllocationAdmin:ALLOCATION_ADMIN}).inspectControlPlane();
 assert.equal(control.adminRights.result,"unknown");assert.equal(control.adminRights.reason,"invalid_kvault_vault_account");
});

test("confirmed admin rollover without approved preannouncement breaches",async()=>{
 const previous={slot:100,observedAt:"2026-09-27T10:00:00.000Z",authorities:{vaultAdmin:{current:VAULT_ADMIN},allocationAdmin:{current:ALLOCATION_ADMIN},programUpgrade:{current:AUTHORITY},pendingAdmin:{current:VAULT_ADMIN}}};
 const nextAdmin="11111111111111111111111111111111";
 const current={slot:101,observedAt:"2026-09-27T10:01:00.000Z",authorities:{vaultAdmin:{current:nextAdmin},allocationAdmin:{current:ALLOCATION_ADMIN},programUpgrade:{current:AUTHORITY},pendingAdmin:{current:nextAdmin}}};
 const results=evaluateAdminRollovers({previous,current,announcements:[],registryFresh:true,changedAt:"2026-09-27T10:00:30.000Z"}),result=results.find(item=>item.role==="vault_admin_authority");
 assert.equal(result.ruleId,"kamino-kvault-unannounced-admin-rollover");
 assert.equal(result.result,"breach");
 assert.equal(result.from,VAULT_ADMIN);
 assert.equal(result.to,nextAdmin);
 assert.equal(result.firstChangedSlot,101);
 assert.equal(result.reason,"confirmed_admin_rollover_without_matching_preannouncement");
});

test("approved preannouncement passes and unavailable registry stays unknown",()=>{
 const previous={slot:100,authorities:{vaultAdmin:{current:VAULT_ADMIN}}},nextAdmin="11111111111111111111111111111111",current={slot:101,observedAt:"2026-09-27T10:01:00.000Z",authorities:{vaultAdmin:{current:nextAdmin}}},announcement={vault:KAMINO.vault,role:"vault_admin_authority",from:VAULT_ADMIN,to:nextAdmin,announcedAt:"2026-09-27T09:00:00.000Z",sourceUrl:"https://governance.example/change",contentHash:"sha256:test",approvedBy:"governance"};
 assert.equal(evaluateAdminRollovers({previous,current,announcements:[announcement],registryFresh:true})[0].result,"pass");
 const unknown=evaluateAdminRollovers({previous,current,announcements:[],registryFresh:false})[0];assert.equal(unknown.result,"unknown");assert.equal(unknown.reason,"announcement_registry_unavailable_or_stale");
});

test("announcement registry accepts explicit reviewed JSON only",()=>{
 const announcement={vault:KAMINO.vault,role:"vault_admin_authority",from:VAULT_ADMIN,to:"11111111111111111111111111111111",announcedAt:"2026-09-27T09:00:00.000Z",sourceUrl:"https://governance.example/change",contentHash:"sha256:test",approvedBy:"governance"};
 assert.deepEqual(announcementRegistryFromEnv({KAMINO_ANNOUNCEMENTS_JSON:JSON.stringify([announcement]),KAMINO_ANNOUNCEMENTS_REVIEWED_AT:"2026-09-27T09:01:00.000Z"}),{fresh:true,reviewedAt:"2026-09-27T09:01:00.000Z",announcements:[announcement]});
 assert.deepEqual(announcementRegistryFromEnv({KAMINO_ANNOUNCEMENTS_JSON:"[]"}),{fresh:false,reviewedAt:null,announcements:[]});
});

test("pending admin change without preannouncement is review",()=>{
 const previous={slot:100,authorities:{pendingAdmin:{current:VAULT_ADMIN}}},nextAdmin="11111111111111111111111111111111",current={slot:101,observedAt:"2026-09-27T10:01:00.000Z",authorities:{pendingAdmin:{current:nextAdmin}}};
 const result=evaluateAdminRollovers({previous,current,announcements:[],registryFresh:true});
 assert.equal(result.length,1);assert.equal(result[0].role,"pending_admin");assert.equal(result[0].result,"review");assert.equal(result[0].reason,"pending_admin_changed_without_matching_preannouncement");
});

test("discovers Steakhouse USDG High Yield shares and values position",async()=>{
 const result=await createKaminoInspector({fetchImpl:fixtureFetch(),rpcUrl:"https://rpc"}).inspect(WALLET);
 assert.equal(result.position.vault,KAMINO.vault);
 assert.equal(result.position.totalShares,"100");
 assert.equal(result.position.underlyingAmount,"107.0707005112529878");
 assert.equal(result.position.asset,"USDG");
 assert.equal(result.authority.status,"active");
 assert.equal(result.authority.current,AUTHORITY);
});

test("raises authority breach when ProgramData authority differs",async()=>{
 const changed="11111111111111111111111111111111";
 const result=await createKaminoInspector({fetchImpl:fixtureFetch({authority:changed}),rpcUrl:"https://rpc"}).inspect(WALLET);
 assert.equal(result.authority.status,"breach");
 assert.equal(result.authority.current,changed);
});

test("dust check excludes token positions at exactly 0.001",async()=>{
 const result=await createKaminoInspector({fetchImpl:fixtureFetch({shares:"0.001",rate:"1"}),rpcUrl:"https://rpc"}).inspect(WALLET);
 assert.equal(result.position,null);
 assert.equal(result.authority,null);
 assert.equal(result.sourceStatus,"dust_filtered");
 assert.match(result.message,/dust check/i);
 const root=new URL("../",import.meta.url),html=readFileSync(new URL("subapps/kamino-monitor/web/index.html",root),"utf8"),app=readFileSync(new URL("subapps/kamino-monitor/web/app.js",root),"utf8");
 assert.match(html,/id="pending-title"/);assert.match(app,/data\.sourceStatus==="dust_filtered"/);assert.match(app,/Dust check/);
});

test("dust check uses underlying token amount rather than vault shares",async()=>{
 const dust=await createKaminoInspector({fetchImpl:fixtureFetch({shares:"0.002",rate:"0.5"}),rpcUrl:"https://rpc"}).inspect(WALLET);
 assert.equal(dust.position,null);
 assert.equal(dust.sourceStatus,"dust_filtered");
 const visible=await createKaminoInspector({fetchImpl:fixtureFetch({shares:"0.0005",rate:"3"}),rpcUrl:"https://rpc"}).inspect(WALLET);
 assert.equal(visible.position.underlyingAmount,"0.0015");
});

test("valid wallet with no indexed target position still reports control-plane evidence",async()=>{
 const fetchImpl=fixtureFetch({shares:"0"}),inspector=createKaminoInspector({fetchImpl,rpcUrl:"https://rpc",expectedVaultAdmin:VAULT_ADMIN,expectedPendingAdmin:VAULT_ADMIN,expectedAllocationAdmin:ALLOCATION_ADMIN});
 const result=await inspector.inspect(WALLET);
 assert.equal(result.position,null);
 assert.equal(result.authority,null);
 assert.equal(result.vaultAuthority.ruleId,"kamino-kvault-effective-admin-rights");
 assert.equal(result.vaultAuthority.result,"pass");
 assert.equal(result.sourceStatus,"kamino_index_pending_or_no_position");
 assert.match(result.message,/fresh deposits may take time/i);
});

test("production UI auto-retries a freshly deposited position",async()=>{
 const root=new URL("../",import.meta.url);const html=readFileSync(new URL("subapps/kamino-monitor/web/index.html",root),"utf8");const app=readFileSync(new URL("subapps/kamino-monitor/web/app.js",root),"utf8");
 assert.match(html,/Waiting for Kamino indexing/);assert.match(html,/id="pending-wallet"/);
 assert.match(app,/pendingTimer=setInterval/);assert.match(app,/10000/);assert.match(app,/pending-wallet/);
});

test("server polls control plane without a monitored wallet and deduplicates rollovers",async()=>{
 const nextAdmin="11111111111111111111111111111111",baseline={ruleId:"kamino-kvault-effective-admin-rights",result:"pass",slot:100,observedAt:"2026-09-27T10:00:00.000Z",authorities:{vaultAdmin:{current:VAULT_ADMIN},pendingAdmin:{current:VAULT_ADMIN},allocationAdmin:{current:ALLOCATION_ADMIN},programUpgrade:{current:AUTHORITY}}},changed={...baseline,result:"breach",slot:101,observedAt:"2026-09-27T10:01:00.000Z",authorities:{...baseline.authorities,vaultAdmin:{current:nextAdmin}}};let calls=0;
 const inspector={inspectControlPlane:async()=>({adminRights:calls++?changed:baseline}),inspect:async()=>({})};
 const server=createKaminoMonitorServer({inspector,pollMs:5,announcementRegistry:{fresh:true,announcements:[]}});server.listen(0,"127.0.0.1");await once(server,"listening");
 try{await new Promise(resolve=>setTimeout(resolve,35));const status=await(await fetch(`http://127.0.0.1:${server.address().port}/api/status`)).json();assert.equal(status.monitoredWallet,null);assert.equal(status.controlLast.adminRights.slot,101);assert.equal(status.controlIncidents.length,1);assert.equal(status.controlIncidents[0].result,"breach");assert.equal(status.controlIncidents[0].role,"vault_admin_authority")}finally{server.close();await once(server,"close")}
});

test("serves production health, config and inspection API",async()=>{
 const server=createKaminoMonitorServer({inspector:createKaminoInspector({fetchImpl:fixtureFetch(),rpcUrl:"https://rpc"})});server.listen(0,"127.0.0.1");await once(server,"listening");
 const base=`http://127.0.0.1:${server.address().port}`;
 try{
  assert.equal((await fetch(`${base}/healthz`)).status,200);
  const config=await(await fetch(`${base}/api/config`)).json();assert.equal(config.network,"mainnet");assert.equal(config.vault,KAMINO.vault);
  const inspected=await(await fetch(`${base}/api/inspect/${WALLET}`)).json();assert.equal(inspected.position.asset,"USDG");
  const page=await fetch(base);assert.match(page.headers.get("content-security-policy"),/default-src 'self'/);assert.match(page.headers.get("content-security-policy"),/connect-src 'self' https:\/\/api\.kelvara\.xyz/);
  for(const asset of ["authority-flow-background.svg","steakhouse-usdg.svg","kamino.svg","wallets/phantom.svg","wallets/solflare.svg","wallets/backpack.svg"]){const response=await fetch(`${base}/assets/${asset}`);assert.equal(response.status,200);assert.match(response.headers.get("content-type"),/image\/svg\+xml/)}
 }finally{server.close();await once(server,"close")}
});

test("public frontend targets the dedicated API origin",()=>{
 const root=new URL("../",import.meta.url),app=readFileSync(new URL("subapps/kamino-monitor/web/app.js",root),"utf8");
 assert.match(app,/https:\/\/api\.kelvara\.xyz/);assert.match(app,/function apiUrl/);assert.match(app,/fetch\(apiUrl\(path\)/);
});

test("backend enforces exact production CORS and preflight",async()=>{
 const server=createKaminoMonitorServer({inspector:createKaminoInspector({fetchImpl:fixtureFetch(),rpcUrl:"https://rpc"}),allowedOrigins:["https://app.kelvara.xyz"]});server.listen(0,"127.0.0.1");await once(server,"listening");const base=`http://127.0.0.1:${server.address().port}`;
 try{
  const allowed=await fetch(`${base}/healthz`,{headers:{origin:"https://app.kelvara.xyz"}});assert.equal(allowed.status,200);assert.equal(allowed.headers.get("access-control-allow-origin"),"https://app.kelvara.xyz");
  const denied=await fetch(`${base}/healthz`,{headers:{origin:"https://evil.example"}});assert.equal(denied.status,403);assert.equal(denied.headers.get("access-control-allow-origin"),null);
  const preflight=await fetch(`${base}/api/auth/challenge`,{method:"OPTIONS",headers:{origin:"https://app.kelvara.xyz","access-control-request-method":"POST","access-control-request-headers":"content-type,authorization"}});assert.equal(preflight.status,204);assert.equal(preflight.headers.get("access-control-allow-methods"),"GET, POST, OPTIONS");
 }finally{server.close();await once(server,"close")}
});

test("local frontend module requests are allowed only from the local app",async()=>{
 const server=createKaminoMonitorServer({inspector:createKaminoInspector({fetchImpl:fixtureFetch(),rpcUrl:"https://rpc"})});server.listen(0,"127.0.0.1");await once(server,"listening");const base=`http://127.0.0.1:${server.address().port}`;
 try{const local=await fetch(`${base}/app.js`,{headers:{origin:"http://127.0.0.1:7650"}});assert.equal(local.status,200);assert.equal(local.headers.get("access-control-allow-origin"),"http://127.0.0.1:7650");assert.match(local.headers.get("content-security-policy"),/frame-ancestors 'self'/)}finally{server.close();await once(server,"close")}
});

test("wallet avatar opens explicit connect and disconnect controls",()=>{
 const root=new URL("../",import.meta.url);const html=readFileSync(new URL("subapps/kamino-monitor/web/index.html",root),"utf8");const app=readFileSync(new URL("subapps/kamino-monitor/web/app.js",root),"utf8");
 assert.match(html,/id="wallet-chip"/);assert.match(html,/id="wallet-menu"/);assert.match(html,/id="wallet-connect-action"/);assert.match(html,/id="wallet-disconnect-action"/);
 assert.match(app,/toggleWalletMenu/);assert.match(app,/disconnectWallet/);assert.match(app,/\.disconnect\(\)/);assert.match(app,/aria-expanded/);
});

test("wallet selector uses local wallet marks and a structured connection state",()=>{
 const root=new URL("../",import.meta.url),html=readFileSync(new URL("subapps/kamino-monitor/web/index.html",root),"utf8"),css=readFileSync(new URL("subapps/kamino-monitor/web/styles.css",root),"utf8"),app=readFileSync(new URL("subapps/kamino-monitor/web/app.js",root),"utf8");
 for(const wallet of ["phantom","solflare","backpack"]){assert.match(html,new RegExp(`/assets/wallets/${wallet}\\.svg`));assert.equal(existsSync(new URL(`subapps/kamino-monitor/web/assets/wallets/${wallet}.svg`,root)),true)}
 assert.doesNotMatch(html,/class="wallet-logo">[PSB]</);
 assert.match(html,/id="wallet-selector-status"/);assert.match(html,/class="wallet-progress idle"/);
 assert.match(css,/\.wallet-selector-card[^}]*padding:/);assert.match(css,/\.wallet-progress\.connecting/);
 assert.match(app,/setWalletSelectorState\("connecting"/);assert.match(app,/setWalletSelectorState\("error"/);
});

test("wallet selector offers Phantom Solflare and Backpack only",()=>{
 const root=new URL("../",import.meta.url);const html=readFileSync(new URL("subapps/kamino-monitor/web/index.html",root),"utf8");const app=readFileSync(new URL("subapps/kamino-monitor/web/app.js",root),"utf8");
 assert.match(html,/id="wallet-selector"/);for(const wallet of ["Phantom","Solflare","Backpack"])assert.match(html,new RegExp(wallet));
 assert.doesNotMatch(html,/WalletConnect/);
 assert.match(app,/connectWallet/);assert.match(app,/window\.phantom\?\.solana/);assert.match(app,/window\.solflare/);assert.match(app,/window\.backpack/);
});

test("stale wallet sessions cannot expose positions or safeguards",()=>{
 const root=new URL("../",import.meta.url),app=readFileSync(new URL("subapps/kamino-monitor/web/app.js",root),"utf8");
 assert.match(app,/function connectedWalletIsCurrent/);
 assert.match(app,/function canViewStage/);
 assert.match(app,/if\(!canViewStage\(name\)\)/);
 assert.match(app,/provider\.on\("disconnect"/);
 assert.match(app,/provider\.on\("accountChanged"/);
 assert.match(app,/clearLocalState\(\)/);
 assert.match(app,/Wallet session ended/);
});

test("pasted address never becomes or restores wallet state",()=>{
 const root=new URL("../",import.meta.url);const html=readFileSync(new URL("subapps/kamino-monitor/web/index.html",root),"utf8");const app=readFileSync(new URL("subapps/kamino-monitor/web/app.js",root),"utf8");
 assert.match(html,/Public Solana address/);assert.match(html,/id="inspect"[^>]*>Inspect position</);
 assert.match(app,/async function viewAddress/);assert.match(app,/setViewedAddress\(address\)/);assert.match(app,/\#inspect"\)\.onclick=viewAddress/);
 const viewBody=app.match(/async function viewAddress\(\)\{([^}]|}(?!\n))*}/s)?.[0]||"";
 assert.doesNotMatch(viewBody,/rememberWallet|walletProvider|provider\(|\.connect\(|localStorage/);
 assert.match(app,/function setViewedAddress/);assert.match(app,/localStorage\.removeItem\("kelvara_prod_wallet"\)/);
 assert.match(app,/connect\(\{onlyIfTrusted:true\}\)/);
 assert.match(app,/localStorage\.getItem\("kelvara_prod_wallet"\)/);
 assert.match(app,/current!==savedAddress/);
});

test("evacuation requires connected wallet review simulation and explicit signature",()=>{
 const root=new URL("../",import.meta.url);const html=readFileSync(new URL("subapps/kamino-monitor/web/index.html",root),"utf8");const js=readFileSync(new URL("subapps/kamino-monitor/web/app.js",root),"utf8");
 assert.match(html,/Prepare protection transaction/);assert.match(html,/Evacuation review/);assert.match(html,/Destination wallet/);assert.match(html,/Priority fee cap/);assert.match(html,/Simulation/);assert.match(html,/Sign and evacuate/);
 assert.match(js,/walletSource==="address"/);assert.match(js,/\/api\/evacuation\/prepare/);assert.match(js,/signTransaction/);assert.match(js,/\/api\/evacuation\/submit/);assert.match(html,/durable nonce/i);assert.match(html,/Fast evacuation is not armed/);
});

test("found position leads to selected-position safeguards",()=>{
 const root=new URL("../",import.meta.url);const html=readFileSync(new URL("subapps/kamino-monitor/web/index.html",root),"utf8");
 assert.match(html,/Positions discovered for this wallet/);assert.match(html,/Preview monitoring/);
 assert.match(html,/Upgrade authority/);assert.match(html,/Who can change the monitored program code/);assert.match(html,/Program deployment record/);
 assert.match(html,/Current address/);assert.match(html,/Expected baseline/);assert.match(html,/Next preannounced address/);assert.match(html,/Last checked/);
 assert.doesNotMatch(html,/Kelvara accepts only shares from this exact vault/);
});

test("production UI implements the approved assurance-canvas design",()=>{
 const root=new URL("../",import.meta.url);const html=readFileSync(new URL("subapps/kamino-monitor/web/index.html",root),"utf8");const css=readFileSync(new URL("subapps/kamino-monitor/web/styles.css",root),"utf8");const app=readFileSync(new URL("subapps/kamino-monitor/web/app.js",root),"utf8");
 assert.match(html,/authority-flow-background\.svg/);assert.match(html,/See what controls your onchain positions/);
 assert.match(html,/id="position-list"/);assert.match(html,/id="safeguard-authority"/);assert.match(html,/Keep this position under live watch/);
 assert.match(html,/Steakhouse USDG High Yield/);assert.match(html,/steakhouse-usdg\.svg/);assert.match(html,/kamino\.svg/);
 assert.doesNotMatch(html,/Start over/);assert.doesNotMatch(html,/7D APY/);assert.doesNotMatch(html,/Inspect evidence/);assert.doesNotMatch(html,/Check now/);
 assert.match(html,/Prepare protection transaction/);assert.match(css,/\.portfolio-shell/);assert.match(css,/prefers-reduced-motion/);
 assert.match(app,/syncDiagram/);assert.match(app,/safeguard-summary/);
});

test("production UI uses independent product navigation instead of a numbered demo journey",()=>{
 const root=new URL("../",import.meta.url),html=readFileSync(new URL("subapps/kamino-monitor/web/index.html",root),"utf8"),css=readFileSync(new URL("subapps/kamino-monitor/web/styles.css",root),"utf8"),app=readFileSync(new URL("subapps/kamino-monitor/web/app.js",root),"utf8");
 assert.doesNotMatch(html,/class="journey"|journey-step|STEP [1-4]/);
 assert.match(html,/class="product-nav"/);
 for(const route of ["position","authority","monitor"])assert.match(html,new RegExp(`data-step="${route}"`));
 assert.match(html,/id="header-connect"/);
 assert.doesNotMatch(html,/id="connect"/);
 assert.match(html,/id="connect-wallet"/);
 assert.doesNotMatch(html,/api\.kelvara\.xyz/);
 assert.match(css,/\.connect-stage[^}]*min-height:/);
 assert.match(css,/#stage-connect\.active\{[^}]*display:flex[^}]*flex-direction:column[^}]*overflow:visible/);
 assert.match(css,/#stage-connect\.active \.authority-bg\{[^}]*position:relative[^}]*order:2/);
 assert.match(app,/\.product-nav button/);
});

test("production UI provides wallet inspection and monitoring surfaces",async()=>{
 const server=createKaminoMonitorServer({inspector:createKaminoInspector({fetchImpl:fixtureFetch(),rpcUrl:"https://rpc"})});server.listen(0,"127.0.0.1");await once(server,"listening");
 const base=`http://127.0.0.1:${server.address().port}`;
 try{
  const html=await(await fetch(base)).text();const app=await(await fetch(`${base}/app.js`)).text();
  for(const surface of ["Positions","Safeguards","Monitor"])assert.match(html,new RegExp(surface));
  assert.match(html,/Connect wallet/);assert.match(html,/Steakhouse USDG High Yield/);assert.match(html,/Activate monitoring/);assert.match(html,/never asks for your private key or seed phrase/i);
  assert.doesNotMatch(html,/Mainnet MVP|Read-only · no signatures|never asks for a transaction/i);
  assert.match(app,/window\.solana/);assert.match(app,/\/api\/inspect\//);assert.match(app,/underlyingAmount/);assert.match(app,/\.meaning/);
  assert.match(app,/localStorage/);assert.match(app,/setInterval/);assert.match(app,/signTransaction/);assert.doesNotMatch(app,/privateKey|secretKey|seedPhrase/);
 }finally{server.close();await once(server,"close")}
});

test("local production launcher avoids simulation port 7640 and binds 7650",()=>{
 const root=new URL("../",import.meta.url);const launcher=readFileSync(new URL("subapps/kamino-monitor/start-local.sh",root),"utf8");
 assert.match(launcher,/PORT="\$\{PORT:-7650\}"/);assert.doesNotMatch(launcher,/PORT="\$\{PORT:-7640\}"/);assert.match(launcher,/\/healthz/);assert.match(launcher,/kamino-monitor\/server\.js/);
});

test("canonical subapp launcher delegates to the local launcher",()=>{
 const root=new URL("../",import.meta.url);const launcher=readFileSync(new URL("subapps/kamino-monitor/start.sh",root),"utf8");
 assert.match(launcher,/start-local\.sh/);assert.match(launcher,/exec/);
});

test("rejects invalid wallet without upstream calls",async()=>{
 let called=false;const inspector=createKaminoInspector({fetchImpl:async()=>{called=true},rpcUrl:"https://rpc"});
 await assert.rejects(()=>inspector.inspect("bad"),/invalid_wallet/);assert.equal(called,false);
});

test("production container runs unprivileged with a health check",()=>{
 const root=new URL("../",import.meta.url);
 const dockerfile=readFileSync(new URL("Dockerfile",root),"utf8");
 const compose=readFileSync(new URL("compose.yaml",root),"utf8");
 assert.match(dockerfile,/USER node/);assert.match(dockerfile,/HEALTHCHECK/);assert.match(dockerfile,/subapps\/kamino-monitor\/server\.js/);
 assert.match(compose,/SOLANA_RPC_URL/);assert.match(compose,/MONITORED_WALLET/);assert.doesNotMatch(compose,/PRIVATE_KEY|SEED_PHRASE|WALLET_FILE/);
});
