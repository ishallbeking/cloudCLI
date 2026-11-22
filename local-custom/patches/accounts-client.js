// Compatibility UI for the pinned prebuilt client: f = React, Cu = useAuth.
// Use the existing authenticated request helper for all account operations.
const cloudcliAccountsApi = {
    async create(username, password) {
        const response = await ht('/api/auth/accounts', { method: 'POST', body: JSON.stringify({ username, password }) });
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
function CloudcliAccountIcon({ className }) {
    return s.jsxs("svg", { className: className, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "1.7", "aria-hidden": "true", children: [s.jsx("circle", { cx: "12", cy: "8", r: "4" }), s.jsx("path", { d: "M4 21v-2a8 8 0 0 1 16 0v2" })] });
}
/** Mounted by Settings; account creation keeps the existing login and group owner. */
function CloudcliAccountSettings() {
    const { user, logout } = Cu();
    // Keep unsent credentials local to this form; never persist them in storage.
    const [form, setForm] = f.useState({ username: '', password: '', confirmation: '' });
    // Disable competing actions and retain a useful result if registration fails.
    const [result, setResult] = f.useState({ pending: false, error: '', created: '' });
    function field(key, value) {
        setForm(previous => ({ ...previous, [key]: value }));
        setResult(previous => ({ ...previous, error: '', created: '' }));
    }
    async function register(event) {
        event.preventDefault();
        if (result.pending)
            return;
        const username = form.username.trim();
        let error = '';
        if (username.length < 3 || form.password.length < 6)
            error = '用户名至少 3 个字符，密码至少 6 个字符。';
        else if (new TextEncoder().encode(form.password).length > 72)
            error = '密码最多 72 个 UTF-8 字节。';
        else if (form.password !== form.confirmation)
            error = '两次输入的密码不一致。';
        if (error) {
            setResult({ pending: false, error, created: '' });
            return;
        }
        setResult({ pending: true, error: '', created: '' });
        try {
            const created = await cloudcliAccountsApi.create(username, form.password);
            setForm({ username: '', password: '', confirmation: '' });
            setResult({ pending: false, error: '', created: created.username });
        }
        catch (failure) {
            setResult({ pending: false, error: failure.message || '注册失败，请重试。', created: '' });
        }
    }
    function signOut() {
        // Unmount the workspace, disconnect sockets and discard all transient group
        // snapshots before another account signs in. Server-side runs continue.
        logout();
        window.location.replace('/');
    }
    return s.jsxs("section", { className: "cca-settings", "data-testid": "account-settings", children: [s.jsxs("header", { children: [s.jsx("h2", { children: "\u8D26\u53F7" }), s.jsx("p", { children: "\u7BA1\u7406\u7F51\u9875\u767B\u5F55\u548C\u4E2A\u4EBA\u7EC4" })] }), s.jsxs("div", { className: "cca-card", children: [s.jsx("h3", { children: "\u5F53\u524D\u8D26\u53F7" }), s.jsxs("div", { className: "cca-current", children: [s.jsx("span", { className: "cca-avatar", children: s.jsx(CloudcliAccountIcon, {}) }), s.jsxs("div", { children: [s.jsx("strong", { "data-testid": "account-username", children: user?.username }), s.jsx("p", { children: "\u7EC4\u6309\u8D26\u53F7\u72EC\u7ACB\u4FDD\u5B58" })] })] }), s.jsx("p", { className: "cca-note", children: "\u9000\u51FA\u767B\u5F55\u4F1A\u4FDD\u7559\u8D26\u53F7\u3001\u7EC4\u548C\u4F1A\u8BDD\uFF0C\u4E0B\u6B21\u53EF\u4F7F\u7528\u7528\u6237\u540D\u548C\u5BC6\u7801\u767B\u5F55\u3002" }), s.jsx("button", { type: "button", className: "cca-button", disabled: result.pending, onClick: signOut, children: "\u9000\u51FA\u767B\u5F55" })] }), s.jsxs("div", { className: "cca-card", children: [s.jsx("h3", { children: "\u6CE8\u518C\u65B0\u8D26\u53F7" }), s.jsx("p", { className: "cca-note", children: "\u65B0\u8D26\u53F7\u62E5\u6709\u81EA\u5DF1\u7684\u7EC4\u3002\u6CE8\u518C\u540E\u4ECD\u4FDD\u7559\u5F53\u524D\u767B\u5F55\uFF0C\u9000\u51FA\u540E\u5373\u53EF\u4F7F\u7528\u65B0\u8D26\u53F7\u767B\u5F55\u3002" }), s.jsxs("form", { onSubmit: register, className: "cca-form", children: [s.jsxs("label", { children: ["\u7528\u6237\u540D", s.jsx("input", { name: "new-username", autoComplete: "off", required: true, minLength: 3, maxLength: 128, value: form.username, onChange: event => field('username', event.target.value), disabled: result.pending, placeholder: "\u81F3\u5C11 3 \u4E2A\u5B57\u7B26" })] }), s.jsxs("label", { children: ["\u5BC6\u7801", s.jsx("input", { name: "new-password", autoComplete: "new-password", type: "password", required: true, minLength: 6, maxLength: 72, value: form.password, onChange: event => field('password', event.target.value), disabled: result.pending, placeholder: "\u81F3\u5C11 6 \u4E2A\u5B57\u7B26" })] }), s.jsxs("label", { children: ["\u786E\u8BA4\u5BC6\u7801", s.jsx("input", { name: "confirm-new-password", autoComplete: "new-password", type: "password", required: true, value: form.confirmation, onChange: event => field('confirmation', event.target.value), disabled: result.pending, placeholder: "\u518D\u6B21\u8F93\u5165\u5BC6\u7801" })] }), result.error && s.jsx("p", { role: "alert", className: "cca-error", children: result.error }), result.created && s.jsxs("p", { role: "status", className: "cca-success", children: ["\u8D26\u53F7\u300C", result.created, "\u300D\u5DF2\u521B\u5EFA\uFF0C\u53EF\u4EE5\u9000\u51FA\u5F53\u524D\u8D26\u53F7\u540E\u767B\u5F55\u3002\u65B0\u8D26\u53F7\u7684\u7EC4\u4ECE\u7A7A\u5217\u8868\u5F00\u59CB\u3002"] }), s.jsx("button", { type: "submit", className: "cca-button cca-primary", disabled: result.pending, children: result.pending ? '注册中…' : '注册新账号' })] })] }), s.jsx("p", { className: "cca-note", children: "\u9879\u76EE\u3001\u6587\u4EF6\u53CA\u7EC8\u7AEF\u4F1A\u8BDD\u4F7F\u7528\u8FD9\u53F0\u670D\u52A1\u5668\u7684\u5171\u4EAB\u6570\u636E\uFF1B\u4E2A\u4EBA\u7EC4\u53EA\u5BF9\u81EA\u5DF1\u7684\u8D26\u53F7\u663E\u793A\u3002" })] });
}
function cloudcliAccountIdentity(token) {
    if (!token)
        return null;
    try {
        return String(JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).userId);
    }
    catch {
        return token;
    }
}
// Other tabs must drop old sockets and caches on logout/account changes. Routine
// JWT rotation for the same user must not remount a running conversation.
window.addEventListener('storage', event => {
    if ((event.key === 'auth-token' && cloudcliAccountIdentity(event.oldValue) !== cloudcliAccountIdentity(event.newValue)) || event.key === null)
        window.location.reload();
});
