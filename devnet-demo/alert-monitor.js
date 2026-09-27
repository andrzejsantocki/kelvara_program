export function createAlertMonitor({url=process.env.ALERT_CONSOLE_URL||"http://127.0.0.1:7623"}={}){
 return{async publish(evidence){const response=await fetch(`${url.replace(/\/$/,"")}/api/monitor/evidence`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(evidence)});if(!response.ok)throw new Error(`alert_console_${response.status}`);return response.json()}};
}
