/* Transfer semantic content, never executable App HTML or styles. */
(function(root){
  const html=new Set('p div span br hr h1 h2 h3 h4 h5 h6 strong b em i s del u sup sub ul ol li blockquote pre code table thead tbody tfoot tr th td caption a kbd mark'.split(' '));
  const math=new Set('math mrow mi mo mn mtext msup msub msubsup mfrac msqrt mroot mfenced mtable mtr mtd mover munder munderover mpadded mspace mstyle semantics annotation menclose mmultiscripts mprescripts none'.split(' '));
  const tokens=new Set('token comment prolog doctype cdata punctuation property tag boolean number constant symbol deleted selector attr-name string char builtin inserted operator entity url atrule attr-value keyword function class-name regex important variable bold italic localchat-resource localchat-resource-name localchat-resource-type'.split(' '));
  const mathAttrs=new Set('display mathvariant stretchy fence separator accent accentunder columnalign rowalign columnspacing rowspacing linethickness notation encoding width height depth lspace voffset'.split(' '));
  const key=(turn,index)=>turn.id||`${turn.role}:${index}`;
  function attrs(tag,source){
    const out={};
    for(const [name,value]of Object.entries(source||{})){
      if(typeof value!=='string')continue;
      if(name==='href'&&tag==='a'&&/^https?:\/\//i.test(value)){try{const u=new URL(value);if(!u.username&&!u.password)out.href=u.href;}catch{}}
      else if(name==='title')out.title=value.slice(0,500);
      else if(['colspan','rowspan','start'].includes(name)&&/^\d{1,3}$/.test(value))out[name]=value;
      else if(name==='class'&&!math.has(tag)){const safe=value.split(/\s+/).filter(x=>tokens.has(x)||/^language-[a-z0-9_-]{1,30}$/i.test(x));if(safe.length)out.class=safe.join(' ');}
      else if(math.has(tag)&&mathAttrs.has(name)&&value.length<=80&&!/[<>"'\\]/.test(value))out[name]=value;
    }
    return out;
  }
  function capture(nodes){
    let count=0;
    function visit(node,depth=0){
      if(++count>30000||depth>60)return [];
      if(node.nodeType===3)return [node.data];
      if(node.nodeType!==1&&node.nodeType!==11)return [];
      const tag=node.localName?.toLowerCase();
      if(['script','style','button','input','textarea','select','iframe','object','embed','svg','canvas'].includes(tag)||node.getAttribute?.('role')==='button'||node.getAttribute?.('role')==='status')return [];
      if(node.classList?.contains('group/resource-row')){
        const label=node.querySelector('span[title]');if(label){const title=label.getAttribute('title');return [['span',{class:'localchat-resource',title},[['span',{class:'localchat-resource-type'},[title.split('.').pop().toUpperCase().slice(0,8)]],['span',{class:'localchat-resource-name'},[title]]]]];}
      }
      // KaTeX includes both visual spans and accessible MathML. Keep just the MathML.
      if(node.classList?.contains('katex')||tag==='mjx-container'){
        const formula=node.querySelector('math');if(formula){const result=visit(formula,depth+1);if(result[0]&&(node.closest('.katex-display')||node.getAttribute('display')==='true'))result[0][1].display='block';return result;}
      }
      if(tag==='img')return node.getAttribute('alt')?[node.getAttribute('alt')]:[];
      const children=[...node.childNodes].flatMap(n=>visit(n,depth+1));
      if(!html.has(tag)&&!math.has(tag))return children;
      return [[tag,attrs(tag,Object.fromEntries([...node.attributes].map(a=>[a.name,a.value]))),children]];
    }
    return [...nodes].flatMap(n=>visit(n));
  }
  function patch(parent,tree,depth=0,budget={left:30000}){
    if(!Array.isArray(tree)||depth>60)return;
    let index=0;
    for(const item of tree){
      if(--budget.left<0)break;
      const text=typeof item==='string',tag=!text&&Array.isArray(item)?item[0]:null;
      if(!text&&!html.has(tag)&&!math.has(tag))continue;
      let node=parent.childNodes[index];const ns=math.has(tag)?'http://www.w3.org/1998/Math/MathML':'http://www.w3.org/1999/xhtml';
      if(text){
        if(node?.nodeType!==3){const next=parent.ownerDocument.createTextNode(item);node?parent.replaceChild(next,node):parent.appendChild(next);node=next;}
        else if(node.data!==item){if(item.startsWith(node.data))node.appendData(item.slice(node.data.length));else node.data=item;}
      }else{
        if(node?.localName!==tag||node.namespaceURI!==ns){const next=parent.ownerDocument.createElementNS(ns,tag);node?parent.replaceChild(next,node):parent.appendChild(next);node=next;}
        const safe=attrs(tag,item[1]);if(tag==='a'&&safe.href){safe.target='_blank';safe.rel='noopener noreferrer';}
        for(const a of [...node.attributes])if(!(a.name in safe))node.removeAttribute(a.name);
        for(const [name,value]of Object.entries(safe))if(node.getAttribute(name)!==value)node.setAttribute(name,value);
        patch(node,item[2],depth+1,budget);
      }
      index++;
    }
    while(parent.childNodes.length>index)parent.lastChild.remove();
  }
  function differ(){
    let prior=new Map(),order='';const signatures=new WeakMap();
    return turns=>{
      const next=new Map(),changed=[],keys=[];
      turns.forEach((turn,index)=>{const id=key(turn,index);keys.push(id);let record=signatures.get(turn);
        if(!record||record.text!==turn.text||record.rich!==turn.rich){record={text:turn.text,rich:turn.rich,signature:JSON.stringify(turn)};signatures.set(turn,record);}
        if(prior.get(id)!==record.signature)changed.push(turn.id?turn:{...turn,id});next.set(id,record.signature);
      });
      const signature=JSON.stringify(keys),result={turns:changed};if(signature!==order)result.order=keys;prior=next;order=signature;return result;
    };
  }
  function apply(turns,event){
    if(event.type==='snapshot')return event.turns;
    const map=new Map(turns.map((t,i)=>[key(t,i),t]));for(const t of event.turns||[])map.set(t.id,t);
    return (event.order||[...map.keys()]).map(id=>map.get(id)).filter(Boolean);
  }
  const api={capture,patch,differ,apply,key};if(typeof module==='object'&&module.exports)module.exports=api;else root.LocalChatRich=api;
})(globalThis);
