(function(root){
  async function read(response,onEvent){
    if(!response.ok)throw Error('本地流式连接失败：'+response.status);
    const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',terminal=false;
    try{for(;;){const {value,done}=await reader.read();buffer+=decoder.decode(value||new Uint8Array(),{stream:!done});let cut;while((cut=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,cut);buffer=buffer.slice(cut+1);if(!line.trim())continue;const event=JSON.parse(line);if(event.type==='complete'||event.type==='error')terminal=true;await onEvent(event);}if(buffer.length>8000000)throw Error('流式响应超过限制');if(done)break;}if(buffer.trim())throw Error('流式响应不完整');if(!terminal)throw Error('连接提前断开，请检查原聊天，未自动重发。');}finally{reader.releaseLock();}
  }
  if(typeof module!=='undefined')module.exports={read};else root.MirrorStream={read};
})(globalThis);
