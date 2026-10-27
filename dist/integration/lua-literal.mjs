// Strict data-only reader for the game's appearance table literals.
// This is intentionally not a Lua source interpreter or JavaScript eval.
export function compileLiteral(vm, source) {
  let s=String(source), p=0;
  const fail=()=>{throw new Error(`Unsupported dynamic Lua expression at ${p}: ${s.slice(p,p+32)}`);};
  const ws=()=>{while(/\s/.test(s[p]||'')&&p<s.length)p++;};
  const take=ch=>{ws();if(s[p]!==ch)fail();p++;};
  const id=()=>{ws();const m=s.slice(p).match(/^[A-Za-z_][A-Za-z0-9_]*/);if(!m)fail();p+=m[0].length;return m[0];};
  function str(){
    const q=s[p++];let out='';while(p<s.length){const c=s[p++];if(c===q)return out;if(c!=='\\'){out+=c;continue;}
      const e=s[p++];const esc={n:'\n',r:'\r',t:'\t',b:'\b',f:'\f',v:'\v','\\':'\\',"'":"'",'"':'"'};
      if(e in esc){out+=esc[e];continue;}
      if(/[0-9]/.test(e)){let digits=e;for(let i=0;i<2&&/[0-9]/.test(s[p]||'');i++)digits+=s[p++];out+=String.fromCharCode(Number(digits));continue;}
      fail();
    }fail();
  }
  function val(){
    ws();const c=s[p];if(c==='"'||c==="'")return str();
    if(c==='{'){
      p++;const t=vm.table({});let n=1;ws();
      while(s[p]!=='}'){
        if(p>=s.length)fail();let k,v;
        if(s[p]==='['){p++;k=val();take(']');take('=');v=val();}
        else if(/[A-Za-z_]/.test(s[p])){
          const saved=p;const name=id();ws();
          if(s[p]==='='){p++;k=name;v=val();}else{p=saved;k=n++;v=val();}
        }else{k=n++;v=val();}
        vm.rawset(t,k,v);ws();if(s[p]===','||s[p]===';'){p++;ws();}else if(s[p]!=='}')fail();
      }
      p++;return t;
    }
    const m=s.slice(p).match(/^[+-]?(?:0x[0-9a-fA-F]+|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)/);
    if(m){p+=m[0].length;const n=Number(m[0]);if(!Number.isFinite(n))fail();return n;}
    const word=id();if(word==='true')return true;if(word==='false')return false;if(word==='nil')return null;fail();
  }
  ws();if(s.slice(p,p+6)!=='return'||/[A-Za-z0-9_]/.test(s[p+6]||''))fail();p+=6;
  const value=val();ws();if(s[p]===';'){p++;ws();}if(p!==s.length)fail();
  return ()=>value;
}
