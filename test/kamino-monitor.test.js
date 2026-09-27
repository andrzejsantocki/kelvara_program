import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createKaminoInspector, createKaminoMonitorServer, KAMINO } from "../subapps/kamino-monitor/server.js";

const WALLET = "883AnESJiUVzCnwowgaWCpXp4EGsK4JMVzUUUcjSSs62";
const AUTHORITY = KAMINO.expectedUpgradeAuthority;
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function decode58(value){let n=0n;for(const c of value)n=n*58n+BigInt(ALPHABET.indexOf(c));const out=[];while(n){out.push(Number(n%256n));n/=256n}out.reverse();let leading=0;while(value[leading]==="1")leading++;return Buffer.from([...new Array(leading).fill(0),...out])}
function programDataBytes(authority=AUTHORITY){const data=Buffer.alloc(45);data.writeUInt32LE(3,0);data.writeBigUInt64LE(432874668n,4);data[12]=1;decode58(authority).copy(data,13);return data}
function programBytes(){const data=Buffer.alloc(36);data.writeUInt32LE(2,0);decode58(KAMINO.programData).copy(data,4);return data}
function fixtureFetch({authority=AUTHORITY,shares="100",rate="1.070707005112529878"}={}){return async (url,options={})=>{
 const body=options.body&&JSON.parse(options.body);
 let value;
 if(String(url).includes("/positions")) value=[{vaultAddress:KAMINO.vault,stakedShares:shares,unstakedShares:"0",totalShares:shares}];
 else if(String(url).includes("/metrics")) value={tokensPerShare:rate,apy7d:"0.073"};
 else if(body?.params?.[0]===KAMINO.program) value={context:{slot:10},value:{owner:KAMINO.loader,data:[programBytes().toString("base64"),"base64"],executable:true}};
 else if(body?.params?.[0]===KAMINO.programData) value={context:{slot:11},value:{owner:KAMINO.loader,data:[programDataBytes(authority).toString("base64"),"base64"],executable:false}};
 else throw new Error(`unexpected:${url}`);
 return {ok:true,status:200,json:async()=>String(url).includes("rpc")?{result:value}:value};
}}

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

test("valid wallet with no indexed target position reports pending index evidence",async()=>{
 const fetchImpl=async url=>({ok:true,status:200,json:async()=>String(url).includes("/positions")?[]:{}});
 const result=await createKaminoInspector({fetchImpl,rpcUrl:"https://rpc"}).inspect(WALLET);
 assert.equal(result.position,null);
 assert.equal(result.authority,null);
 assert.equal(result.sourceStatus,"kamino_index_pending_or_no_position");
 assert.match(result.message,/fresh deposits may take time/i);
});

test("production UI auto-retries a freshly deposited position",async()=>{
 const root=new URL("../",import.meta.url);const html=readFileSync(new URL("subapps/kamino-monitor/web/index.html",root),"utf8");const app=readFileSync(new URL("subapps/kamino-monitor/web/app.js",root),"utf8");
 assert.match(html,/Waiting for Kamino indexing/);assert.match(html,/id="pending-wallet"/);
 assert.match(app,/pendingTimer=setInterval/);assert.match(app,/10000/);assert.match(app,/pending-wallet/);
});

test("serves production health, config and inspection API",async()=>{
 const server=createKaminoMonitorServer({inspector:createKaminoInspector({fetchImpl:fixtureFetch(),rpcUrl:"https://rpc"})});server.listen(0,"127.0.0.1");await once(server,"listening");
 const base=`http://127.0.0.1:${server.address().port}`;
 try{
  assert.equal((await fetch(`${base}/healthz`)).status,200);
  const config=await(await fetch(`${base}/api/config`)).json();assert.equal(config.network,"mainnet");assert.equal(config.vault,KAMINO.vault);
  const inspected=await(await fetch(`${base}/api/inspect/${WALLET}`)).json();assert.equal(inspected.position.asset,"USDG");
  const page=await fetch(base);assert.match(page.headers.get("content-security-policy"),/default-src 'self'/);assert.match(page.headers.get("content-security-policy"),/connect-src 'self' https:\/\/api\.kelvara\.xyz/);
  for(const asset of ["authority-flow-background.svg","steakhouse-usdg.svg","kamino.svg"]){const response=await fetch(`${base}/assets/${asset}`);assert.equal(response.status,200);assert.match(response.headers.get("content-type"),/image\/svg\+xml/)}
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
 assert.doesNotMatch(app,/localStorage\.getItem\("kelvara_prod_wallet"\)/);
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
