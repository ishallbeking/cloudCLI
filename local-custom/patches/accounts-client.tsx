// Compatibility UI for the pinned prebuilt client: f = React, Cu = useAuth.
// Use the existing authenticated request helper for all account operations.
const cloudcliAccountsApi = {
  async create(username: string, password: string) {
    const response = await ht('/api/auth/accounts', {method: 'POST', body: JSON.stringify({username, password})});
    const data = await response.json();
    if (!response.ok || !data.success) {
      const messages = {
        AUTH_USERNAME_CONFLICT: '这个用户名已被使用，请换一个。',
        AUTH_CREDENTIALS_REQUIRED: '请填写用户名和密码。',
        AUTH_CREDENTIALS_TOO_SHORT: '用户名至少 3 个字符，密码至少 6 个字符。',
        AUTH_CREDENTIALS_TOO_LONG: '用户名最多 128 个字符，密码最多 72 个 UTF-8 字节。',
      };
      throw new Error(messages[data.error?.code || data.code] || Po(data) || '注册失败，请重试。');
    }
    return data.user;
  },
};

function CloudcliAccountIcon({className}: {className?: string}) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/></svg>;
}

/** Mounted by Settings; account creation keeps the existing login and group owner. */
function CloudcliAccountSettings() {
  const {user, logout} = Cu();
  // Keep unsent credentials local to this form; never persist them in storage.
  const [form, setForm] = f.useState({username: '', password: '', confirmation: ''});
  // Disable competing actions and retain a useful result if registration fails.
  const [result, setResult] = f.useState({pending: false, error: '', created: ''});
  function field(key: string, value: string) {
    setForm(previous => ({...previous, [key]: value}));
    setResult(previous => ({...previous, error: '', created: ''}));
  }
  async function register(event) {
    event.preventDefault();
    if (result.pending) return;
    const username = form.username.trim();
    let error = '';
    if (username.length < 3 || form.password.length < 6) error = '用户名至少 3 个字符，密码至少 6 个字符。';
    else if (new TextEncoder().encode(form.password).length > 72) error = '密码最多 72 个 UTF-8 字节。';
    else if (form.password !== form.confirmation) error = '两次输入的密码不一致。';
    if (error) {setResult({pending: false, error, created: ''}); return;}
    setResult({pending: true, error: '', created: ''});
    try {
      const created = await cloudcliAccountsApi.create(username, form.password);
      setForm({username: '', password: '', confirmation: ''});
      setResult({pending: false, error: '', created: created.username});
    } catch (failure) {
      setResult({pending: false, error: failure.message || '注册失败，请重试。', created: ''});
    }
  }
  function signOut() {
    // Unmount the workspace, disconnect sockets and discard all transient group
    // snapshots before another account signs in. Server-side runs continue.
    logout();
    window.location.replace('/');
  }
  return <section className="cca-settings" data-testid="account-settings">
    <header><h2>账号</h2><p>管理网页登录和个人组</p></header>
    <div className="cca-card">
      <h3>当前账号</h3>
      <div className="cca-current"><span className="cca-avatar"><CloudcliAccountIcon/></span><div><strong data-testid="account-username">{user?.username}</strong><p>组按账号独立保存</p></div></div>
      <p className="cca-note">退出登录会保留账号、组和会话，下次可使用用户名和密码登录。</p>
      <button type="button" className="cca-button" disabled={result.pending} onClick={signOut}>退出登录</button>
    </div>
    <div className="cca-card">
      <h3>注册新账号</h3>
      <p className="cca-note">新账号拥有自己的组。注册后仍保留当前登录，退出后即可使用新账号登录。</p>
      <form onSubmit={register} className="cca-form">
        <label>用户名<input name="new-username" autoComplete="off" required minLength={3} maxLength={128} value={form.username} onChange={event => field('username', event.target.value)} disabled={result.pending} placeholder="至少 3 个字符"/></label>
        <label>密码<input name="new-password" autoComplete="new-password" type="password" required minLength={6} maxLength={72} value={form.password} onChange={event => field('password', event.target.value)} disabled={result.pending} placeholder="至少 6 个字符"/></label>
        <label>确认密码<input name="confirm-new-password" autoComplete="new-password" type="password" required value={form.confirmation} onChange={event => field('confirmation', event.target.value)} disabled={result.pending} placeholder="再次输入密码"/></label>
        {result.error && <p role="alert" className="cca-error">{result.error}</p>}
        {result.created && <p role="status" className="cca-success">账号「{result.created}」已创建，可以退出当前账号后登录。新账号的组从空列表开始。</p>}
        <button type="submit" className="cca-button cca-primary" disabled={result.pending}>{result.pending ? '注册中…' : '注册新账号'}</button>
      </form>
    </div>
    <p className="cca-note">项目、文件及终端会话使用这台服务器的共享数据；个人组只对自己的账号显示。</p>
  </section>;
}

function cloudcliAccountIdentity(token) {
  if (!token) return null;
  try {return String(JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).userId);}
  catch {return token;}
}
// Other tabs must drop old sockets and caches on logout/account changes. Routine
// JWT rotation for the same user must not remount a running conversation.
window.addEventListener('storage', event => {
  if ((event.key === 'auth-token' && cloudcliAccountIdentity(event.oldValue) !== cloudcliAccountIdentity(event.newValue)) || event.key === null) window.location.reload();
});
