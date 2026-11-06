const cloudcliFileSortStorageKey = 'cloudcli:file-sort:v1';
const cloudcliFileNameCollator = new Intl.Collator('zh-CN', {numeric:true, sensitivity:'base'});
function cloudcliInitialFileSort() {
  try {
    const saved = JSON.parse(localStorage.getItem(cloudcliFileSortStorageKey) || 'null');
    if (saved && ['name','size','modified'].includes(saved.key) && ['asc','desc'].includes(saved.direction)) return saved;
  } catch {}
  return {key:'name', direction:'asc'};
}
function cloudcliSortFileTree(files, sort) {
  const direction = sort.direction === 'desc' ? -1 : 1;
  const compareName = (a,b) => cloudcliFileNameCollator.compare(a.name,b.name) ||
    String(a.path).localeCompare(String(b.path));
  const value = item => {
    if (sort.key === 'size') return typeof item.size === 'number' && Number.isFinite(item.size) ? item.size : null;
    const modified = Date.parse(item.modified);
    return Number.isFinite(modified) ? modified : null;
  };
  return files.map(item => Array.isArray(item.children)
    ? {...item, children:cloudcliSortFileTree(item.children,sort)} : item).sort((a,b) => {
      // Keep the hierarchy and folder-first convention; sort only siblings.
      if ((a.type === 'directory') !== (b.type === 'directory')) return a.type === 'directory' ? -1 : 1;
      if (sort.key === 'name') return compareName(a,b) * direction;
      // The size column is blank for folders, so their size ordering stays by name.
      if (sort.key === 'size' && a.type === 'directory') return compareName(a,b);
      const left = value(a), right = value(b);
      if (left === null && right !== null) return 1;
      if (right === null && left !== null) return -1;
      return (left !== null && right !== null ? (left-right) * direction : 0) || compareName(a,b);
    });
}
function useCloudcliFileSort(files) {
  const [sort,setSort] = f.useState(cloudcliInitialFileSort);
  const onSort = f.useCallback(key => setSort(previous => ({key,
    direction:previous.key === key ? previous.direction === 'asc' ? 'desc' : 'asc' : key === 'name' ? 'asc' : 'desc',
  })), []);
  f.useEffect(() => {
    try { localStorage.setItem(cloudcliFileSortStorageKey,JSON.stringify(sort)); } catch {}
  }, [sort]);
  const sorted = f.useMemo(() => cloudcliSortFileTree(files,sort),[files,sort]);
  return {sort,onSort,files:sorted};
}
function CloudcliFileSortHeader({sort,onSort}) {
  const {t} = Te();
  return s.jsx('div',{className:'border-b border-border px-3 pb-1 pt-1.5',children:
    s.jsxs('div',{className:'grid grid-cols-12 gap-2 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70',children:[
      ...[['name','col-span-5',t('fileTree.name')],['size','col-span-2',t('fileTree.size')],['modified','col-span-3',t('fileTree.modified')]].map(([key,width,label])=>{
        const active=sort.key===key;
        const next=active ? sort.direction==='asc'?'降序':'升序' : key==='name'?'升序':'降序';
        return s.jsx('div',{className:width,children:s.jsxs('button',{
          type:'button','data-file-sort':key,'data-sort-direction':active?sort.direction:'none',
          onClick:()=>onSort(key),title:`按${label}${next}排序`,
          'aria-label':`${label}排序`,'aria-pressed':active,
          className:Se('inline-flex min-h-6 max-w-full items-center gap-1 rounded px-1 -ml-1 text-left transition-colors hover:bg-accent hover:text-foreground',active&&'text-foreground'),
          children:[s.jsx('span',{className:'truncate',children:label}),s.jsx('span',{'aria-hidden':true,className:active?'':'opacity-30',children:active?sort.direction==='asc'?'↑':'↓':'↕'})],
        })},key);
      }),
      s.jsx('div',{className:'col-span-2 flex items-center',children:t('fileTree.permissions')}),
    ]}),
  });
}
