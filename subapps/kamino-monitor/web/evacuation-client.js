const RESPONSE_MAX_BYTES=128*1024;
const REQUEST_TIMEOUT_MS=5000;

function clientError(code,status){const error=new Error(code);error.code=code;if(status!==undefined)error.status=status;return error}
async function readJson(response,signal){
  if(!response?.body)throw clientError("response_body_unavailable");
  const declared=Number(response.headers?.get?.("content-length"));
  if(Number.isFinite(declared)&&declared>RESPONSE_MAX_BYTES)throw clientError("response_too_large");
  const chunks=[];let total=0;
  try{
    if(typeof response.body.getReader==="function"){
      const reader=response.body.getReader();
      for(;;){const {done,value}=await reader.read();if(done)break;const bytes=new Uint8Array(value);total+=bytes.byteLength;if(total>RESPONSE_MAX_BYTES)throw clientError("response_too_large");chunks.push(bytes)}
    }else if(response.body[Symbol.asyncIterator]){
      for await(const value of response.body){const bytes=new Uint8Array(value);total+=bytes.byteLength;if(total>RESPONSE_MAX_BYTES)throw clientError("response_too_large");chunks.push(bytes)}
    }else throw clientError("response_body_unavailable");
  }catch(error){if(error.code==="response_too_large")throw error;if(signal.aborted)throw clientError("request_timeout");throw clientError("response_body_read_failed")}
  if(signal.aborted)throw clientError("request_timeout");
  try{return JSON.parse(new TextDecoder().decode(concat(chunks,total)))}catch{throw clientError("response_malformed_json")}
}
function concat(chunks,total){const result=new Uint8Array(total);let offset=0;for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.byteLength}return result}
async function readResponse(response,signal){const data=await readJson(response,signal);if(!response.ok)throw clientError(typeof data?.error==="string"?data.error:`http_${response.status}`,response.status);return data}

export function createApiClient({apiUrl=path=>path,network,getGenesis,getToken,authenticate,fetchImpl=fetch}={}){
 function headers(){const result={"x-kelvara-network":network};const genesis=getGenesis?.();if(genesis)result["x-kelvara-genesis"]=genesis;const token=getToken?.();if(token)result.authorization=`Bearer ${token}`;return result}
 async function ensureAuthenticated(){if(!getToken?.())await authenticate();if(!getToken?.())throw clientError("authentication_unavailable")}
 async function execute(url,options){const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),REQUEST_TIMEOUT_MS);try{return await readResponse(await fetchImpl(url,{...options,signal:controller.signal}),controller.signal)}catch(error){if(error.name==="AbortError"||controller.signal.aborted)throw clientError("request_timeout");if(error.code)throw error;throw clientError("request_failed")}finally{clearTimeout(timer)}}
 async function request(path,{authenticated=false}={}){if(authenticated)await ensureAuthenticated();return execute(apiUrl(path),{headers:headers()})}
 async function post(path,body={},options={}){if(options.authenticated)await ensureAuthenticated();return execute(apiUrl(path),{method:"POST",headers:{"content-type":"application/json",...headers()},body:JSON.stringify({...body,network})})}
 return {request,post};
}
