import fs from 'node:fs/promises';
export async function patchFileSort(client) {
  function replace(before,after) {
    if(client.split(before).length!==2) throw new Error(`File sort upstream changed: ${before.slice(0,90)}`);
    client=client.replace(before,after);
  }
  client+='\n'+await fs.readFile(new URL('./file-sort-client.js',import.meta.url),'utf8');
  replace('filteredFiles:j}=$Xe({files:p,expandDirectories:k}),E=f.useRef(null)',
    'filteredFiles:j}=$Xe({files:p,expandDirectories:k}),cloudcliSorting=useCloudcliFileSort(j),E=f.useRef(null)');
  replace('s.jsx(sQe,{})','s.jsx(CloudcliFileSortHeader,{sort:cloudcliSorting.sort,onSort:cloudcliSorting.onSort})');
  replace('s.jsx(oQe,{files:p,filteredFiles:j,error:h,searchQuery:C',
    's.jsx(oQe,{files:p,filteredFiles:cloudcliSorting.files,error:h,searchQuery:C');
  return client;
}
