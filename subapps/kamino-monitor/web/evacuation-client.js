export function createApiClient({apiUrl=path=>path,network,getGenesis,getToken,authenticate,fetchImpl=fetch}={}){
 function headers(){const result={"x-kelvara-network":network};const genesis=getGenesis?.();if(genesis)result["x-kelvara-genesis"]=genesis;const token=getToken?.();if(token)result.authorization=`Bearer ${token}`;return result}
 async function ensureAuthenticated(){if(!getToken?.())await authenticate();if(!getToken?.())throw new Error("authentication_unavailable")}
 async function request(path,{authenticated=false}={}){if(authenticated)await ensureAuthenticated();const response=await fetchImpl(apiUrl(path),{headers:headers()});const data=await response.json();if(!response.ok)throw new Error(data.error||`HTTP ${response.status}`);return data}
 async function post(path,body={},options={}){if(options.authenticated)await ensureAuthenticated();const response=await fetchImpl(apiUrl(path),{method:"POST",headers:{"content-type":"application/json",...headers()},body:JSON.stringify({...body,network})});const data=await response.json();if(!response.ok)throw new Error(data.error||`HTTP ${response.status}`);return data}
 return {request,post};
}
