// CloudCLI 1.37.7: keep the sidebar footer focused on settings.
export function patchSidebarFooter(client) {
  // Remove the header's GitHub star widget, including its background API fetch.
  const githubWidget = 's.jsx(Ltt,{})';
  if (client.split(githubWidget).length !== 2) throw new Error('Sidebar GitHub widget changed');
  client = client.replace(githubWidget, 'null');
  const start = client.indexOf('function Mtt(');
  const end = client.indexOf('const $6=', start);
  if (start < 0 || end < start || end - start > 10000) throw new Error('Sidebar footer boundary changed');
  const footer = client.slice(start, end);
  const links = footer.indexOf('s.jsx("div",{className:"hidden px-2 pt-1.5 md:block"');
  const desktop = footer.indexOf('s.jsx("div",{className:"hidden px-2 py-1.5 md:block",children:s.jsxs("button",{className:"flex w-full');
  const version = footer.indexOf(',!cn&&', desktop);
  const mobile = footer.indexOf('s.jsx("div",{className:"px-3 pb-3 pt-2 md:hidden"');
  if (links < 0 || desktop < links || version < desktop || mobile < version || !footer.endsWith(']})}')) {
    throw new Error('Sidebar footer contents changed');
  }
  // Preserve update/restart notices, followed by settings as the last footer row.
  const next = (footer.slice(0, links) + footer.slice(desktop, version) + ',' + footer.slice(mobile))
    .replace('className:"flex-shrink-0",style:', 'className:"mt-auto flex-shrink-0","data-testid":"sidebar-footer",style:');
  return client.slice(0, start) + next + client.slice(end);
}
