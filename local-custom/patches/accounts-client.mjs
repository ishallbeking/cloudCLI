import fs from 'node:fs/promises';
export async function patchAccounts(client) {
  function replace(before, after) {
    if (client.split(before).length !== 2) throw new Error('Accounts anchor changed: ' + before.slice(0,100));
    client = client.replace(before, after);
  }
  const source = await fs.readFile(new URL('./accounts-client.js',import.meta.url),'utf8');
  const css = await fs.readFile(new URL('./accounts-client.css',import.meta.url),'utf8');
  client += '\n' + source;
  replace('const V6=[{id:"agents",', 'const V6=[{id:"account",labelKey:"账号",icon:CloudcliAccountIcon},{id:"agents",');
  replace('Wrt=["agents","appearance",', 'Wrt=["account","agents","appearance",');
  // Background provider-status refreshes may change callback identities; they
  // must not reset the selected account tab or discard its registration form.
  replace('f.useEffect(()=>{e&&(i(dA(t)),P(),D())},[t,e,P,D])',
    'f.useEffect(()=>{e&&i(dA(t))},[t,e]),f.useEffect(()=>{e&&(P(),D())},[t,e,P,D])');
  replace('c==="about"&&s.jsx(Vrt,{})', 'c==="account"&&s.jsxs(s.Fragment,{children:[s.jsx("style",{children:'+JSON.stringify(css)+'}),s.jsx(CloudcliAccountSettings,{})]}),c==="about"&&s.jsx(Vrt,{})');
  return client;
}
