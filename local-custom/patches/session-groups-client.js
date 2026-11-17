// Compatibility component for the pinned prebuilt client. f is React; the
// existing dialog/provider-logo primitives retain native focus and navigation.
// Transport is centralized here and uses the application's authenticated helper.
const CloudcliGroupMenu = nf;
const cloudcliGroupsApi = {
    async request(suffix = '', method = 'GET', body, signal) {
        const response = await ht('/api/providers/session-groups' + suffix, {
            method, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal,
        });
        const json = await response.json();
        if (!response.ok || json.success === false)
            throw new Error(json.error?.message || json.error || '操作失败，请重试。');
        return json.data;
    },
    list: signal => cloudcliGroupsApi.request('', 'GET', undefined, signal),
    candidates: (query, offset, signal) => cloudcliGroupsApi.request(`/candidates?q=${encodeURIComponent(query)}&offset=${offset}`, 'GET', undefined, signal),
    create: name => cloudcliGroupsApi.request('', 'POST', { name }),
    rename: (id, name) => cloudcliGroupsApi.request('/' + encodeURIComponent(id), 'PATCH', { name }),
    remove: id => cloudcliGroupsApi.request('/' + encodeURIComponent(id), 'DELETE'),
    add: (id, sessionIds) => cloudcliGroupsApi.request('/' + encodeURIComponent(id) + '/sessions', 'POST', { sessionIds }),
    removeMember: (id, sessionId) => cloudcliGroupsApi.request('/' + encodeURIComponent(id) + '/sessions/' + encodeURIComponent(sessionId), 'DELETE'),
};
function cloudcliGroupAction(detail) { window.dispatchEvent(new CustomEvent('cloudcli:group-action', { detail })); }
function cloudcliGroupsChanged() { window.dispatchEvent(new Event('cloudcli:groups-changed')); }
function useCloudcliGroups(reloadKey) {
    // Retains the server snapshot while a refresh runs; never optimistically loses memberships.
    const [state, setState] = f.useState({ groups: [], loading: true, error: '' });
    // Invalidates only on explicit local actions, sidebar refresh, or browser focus.
    const [version, setVersion] = f.useState(0);
    f.useEffect(() => {
        const reload = () => setVersion(value => value + 1);
        window.addEventListener('cloudcli:groups-changed', reload);
        window.addEventListener('focus', reload);
        return () => { window.removeEventListener('cloudcli:groups-changed', reload); window.removeEventListener('focus', reload); };
    }, []);
    f.useEffect(() => {
        const controller = new AbortController();
        setState(previous => ({ ...previous, loading: true, error: '' }));
        cloudcliGroupsApi.list(controller.signal).then(data => {
            if (!controller.signal.aborted)
                setState({ groups: data.groups, loading: false, error: '' });
        }).catch(error => {
            if (!controller.signal.aborted)
                setState(previous => ({ ...previous, loading: false, error: error.message }));
        });
        return () => controller.abort();
    }, [version, reloadKey]);
    return { ...state, reload: () => setVersion(value => value + 1) };
}
/** Mounted by SidebarContent only in the groups tab; uses its normal session selection callback. */
function CloudcliSessionGroups({ selectedSession, onSelect, filter = '', reloadKey, sessionActions }) {
    const { groups, loading, error, reload } = useCloudcliGroups(reloadKey);
    // Expansion is view state only; group contents always come from the server.
    const [collapsed, setCollapsed] = f.useState(new Set());
    // Failed removals remain visible and can be retried without changing the transcript.
    const [operation, setOperation] = f.useState({ key: '', error: '' });
    const query = filter.trim().toLowerCase();
    const visibleGroups = groups.map(group => ({ ...group, sessions: group.name.toLowerCase().includes(query) ? group.sessions : group.sessions.filter(row => `${row.sessionTitle} ${row.projectDisplayName} ${row.projectPath || ''}`.toLowerCase().includes(query)) })).filter(group => !query || group.name.toLowerCase().includes(query) || group.sessions.length);
    async function remove(groupId, sessionId) {
        if (operation.key)
            return;
        setOperation({ key: groupId + sessionId, error: '' });
        try {
            await cloudcliGroupsApi.removeMember(groupId, sessionId);
            cloudcliGroupsChanged();
            setOperation({ key: '', error: '' });
        }
        catch (error) {
            setOperation({ key: '', error: error.message });
        }
    }
    return f.createElement("div", { className: "ccg-panel", "data-testid": "session-groups" },
        f.createElement("div", { className: "ccg-toolbar" },
            f.createElement("span", null,
                "\u6211\u7684\u7EC4 ",
                f.createElement("small", null, groups.length)),
            f.createElement("button", { className: "ccg-button", onClick: () => cloudcliGroupAction({ kind: 'create' }) }, "\uFF0B \u521B\u5EFA\u7EC4")),
        f.createElement("p", { className: "ccg-hint" }, "\u5C06\u4E0D\u540C\u9879\u76EE\u7684\u5BF9\u8BDD\u6574\u7406\u5230\u4E00\u8D77"),
        (error || operation.error) && f.createElement("div", { role: "alert", className: "ccg-error" },
            error || operation.error,
            f.createElement("button", { onClick: reload }, "\u91CD\u8BD5")),
        loading && !groups.length && f.createElement("p", { role: "status", className: "ccg-empty" }, "\u6B63\u5728\u52A0\u8F7D\u7EC4\u2026"),
        !loading && !error && !groups.length && f.createElement("div", { className: "ccg-empty" },
            f.createElement("p", null, "\u8FD8\u6CA1\u6709\u7EC4"),
            f.createElement("p", null, "\u521B\u5EFA\u4E00\u4E2A\u7EC4\uFF0C\u52A0\u5165\u76F8\u5173\u5BF9\u8BDD\u3002")),
        !loading && groups.length > 0 && !visibleGroups.length && f.createElement("p", { className: "ccg-empty" }, "\u6CA1\u6709\u5339\u914D\u7684\u7EC4\u6216\u5BF9\u8BDD"),
        visibleGroups.map(group => f.createElement("section", { className: "ccg-group", key: group.id, "data-group-id": group.id },
            f.createElement("div", { className: "ccg-group-header" },
                f.createElement("button", { className: "ccg-group-toggle", "aria-expanded": !collapsed.has(group.id) || !!query, onClick: () => setCollapsed(current => { const next = new Set(current); next.has(group.id) ? next.delete(group.id) : next.add(group.id); return next; }) },
                    f.createElement("span", { "aria-hidden": "true" }, collapsed.has(group.id) && !query ? '›' : '⌄'),
                    f.createElement(CloudcliGroupIcon, null),
                    f.createElement("span", { className: "ccg-truncate", title: group.name }, group.name),
                    f.createElement("small", null, group.sessions.length)),
                f.createElement(CloudcliGroupMenu, { label: "\u7EC4\u64CD\u4F5C", ariaLabel: '组操作：' + group.name, icon: x1, iconOnly: true, portal: true, variant: "ghost", size: "icon", triggerClassName: "h-7 w-7 text-muted-foreground", items: [
                        { key: 'add', label: '加入对话', icon: Oo, onSelect: () => cloudcliGroupAction({ kind: 'add-sessions', group }) },
                        { key: 'rename', label: '重命名组', icon: e8, onSelect: () => cloudcliGroupAction({ kind: 'rename', group }) },
                        { key: 'delete', label: '删除组', icon: jn, isDanger: true, onSelect: () => cloudcliGroupAction({ kind: 'delete', group }) },
                    ] })),
            (!collapsed.has(group.id) || !!query) && f.createElement("div", { className: "ccg-members" },
                group.sessions.map(row => f.createElement("div", { className: 'ccg-session' + (selectedSession?.id === row.sessionId ? ' ccg-selected' : ''), key: row.sessionId, "data-group-session-id": row.sessionId },
                    f.createElement("a", { href: '/session/' + row.sessionId, onClick: event => { if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
                            event.preventDefault();
                            onSelect(row.projectId, row.sessionId, row.provider);
                        } } },
                        f.createElement(Ur, { provider: row.provider, className: "h-3.5 w-3.5" }),
                        f.createElement("span", { className: "ccg-session-text" },
                            f.createElement("span", { className: "ccg-truncate", title: row.sessionTitle }, row.sessionTitle),
                            f.createElement("small", { className: "ccg-truncate", title: row.projectPath || '' },
                                row.projectDisplayName,
                                sessionActions?.activeSessions?.has(row.sessionId) ? ' · 处理中…' : ''))),
                    f.createElement("button", { className: "ccg-icon-button", disabled: !!operation.key, title: "\u4ECE\u7EC4\u4E2D\u79FB\u51FA", "aria-label": '从组中移出：' + row.sessionTitle, onClick: () => remove(group.id, row.sessionId) }, "\u00D7"))),
                !group.sessions.length && f.createElement("p", { className: "ccg-hint ccg-inset" }, query ? '没有匹配的对话' : '组内暂无对话'),
                f.createElement("button", { className: "ccg-add-row", onClick: () => cloudcliGroupAction({ kind: 'add-sessions', group }) }, "\uFF0B \u52A0\u5165\u5BF9\u8BDD")))));
}
function CloudcliGroupIcon({ className = 'h-3 w-3' }) {
    return f.createElement("svg", { className: className, width: "14", height: "14", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "1.6", "aria-hidden": "true" },
        f.createElement("rect", { x: "3", y: "3", width: "7", height: "7", rx: "1.5" }),
        f.createElement("rect", { x: "14", y: "3", width: "7", height: "7", rx: "1.5" }),
        f.createElement("rect", { x: "3", y: "14", width: "7", height: "7", rx: "1.5" }),
        f.createElement("rect", { x: "14", y: "14", width: "7", height: "7", rx: "1.5" }));
}
/** Always mounted in SidebarContent, so session menus can open it in every tab. */
function CloudcliGroupDialogHost() {
    // A single discriminated operation keeps dialogs mutually exclusive across sidebar views.
    const [action, setAction] = f.useState(null);
    f.useEffect(() => {
        const open = event => setAction({ ...event.detail, nonce: Date.now() });
        window.addEventListener('cloudcli:group-action', open);
        return () => window.removeEventListener('cloudcli:group-action', open);
    }, []);
    return action ? f.createElement(CloudcliGroupDialog, { key: action.nonce, action: action, onClose: () => setAction(null) }) : null;
}
function CloudcliGroupDialog({ action, onClose }) {
    // Retains an editable draft until the server acknowledges the requested operation.
    const [name, setName] = f.useState(action.kind === 'rename' ? action.group.name : '');
    // Prevents double submits and keeps failures visible in the same dialog.
    const [status, setStatus] = f.useState({ busy: false, error: '' });
    // Selected group applies only to the "add this session" menu operation.
    const [target, setTarget] = f.useState('');
    // The checkbox set survives searching/paging so selected answers cannot drift by row index.
    const [selected, setSelected] = f.useState(new Set());
    const isPicker = action.kind === 'add-sessions';
    const isTarget = action.kind === 'add-to-group';
    const title = { create: '创建组', rename: '重命名组', delete: '删除组', 'add-sessions': '加入对话', 'add-to-group': '加入组' }[action.kind];
    async function submit(event) {
        event?.preventDefault();
        if (status.busy)
            return;
        setStatus({ busy: true, error: '' });
        try {
            if (action.kind === 'create')
                await cloudcliGroupsApi.create(name.trim());
            if (action.kind === 'rename')
                await cloudcliGroupsApi.rename(action.group.id, name.trim());
            if (action.kind === 'delete')
                await cloudcliGroupsApi.remove(action.group.id);
            if (isPicker)
                await cloudcliGroupsApi.add(action.group.id, [...selected]);
            if (isTarget) {
                // Creating a group is durable even if adding the session subsequently fails.
                // Retain its ID for a retry instead of silently creating a duplicate group.
                let groupId = target;
                if (target === '__new') {
                    const group = await cloudcliGroupsApi.create(name.trim());
                    groupId = group.id;
                    setTarget(groupId);
                    cloudcliGroupsChanged();
                }
                await cloudcliGroupsApi.add(groupId, [action.sessionId]);
            }
            cloudcliGroupsChanged();
            onClose();
        }
        catch (error) {
            setStatus({ busy: false, error: error.message });
        }
    }
    const needsName = action.kind === 'create' || action.kind === 'rename' || (isTarget && target === '__new');
    const valid = (!needsName || !!name.trim()) && (!isPicker || selected.size > 0) && (!isTarget || !!target);
    return f.createElement(_i, { open: true, onOpenChange: open => { !open && !status.busy && onClose(); } },
        f.createElement(Ts, { className: "ccg-dialog", "aria-labelledby": "ccg-dialog-title", "aria-describedby": "ccg-dialog-description" },
            f.createElement(As, { id: "ccg-dialog-title", className: "ccg-dialog-title" }, title),
            f.createElement("p", { id: "ccg-dialog-description", className: "ccg-hint" }, action.kind === 'delete' ? `删除“${action.group.name}”只会移除分组，对话会保留。` : isPicker ? `选择要加入“${action.group.name}”的对话，可跨项目选择。` : isTarget ? `将“${action.sessionName}”加入已有组或新组。` : '组可收纳不同项目的对话。'),
            f.createElement("form", { onSubmit: submit },
                isTarget && f.createElement(CloudcliGroupTarget, { target: target, setTarget: setTarget, busy: status.busy }),
                needsName && f.createElement("label", { className: "ccg-label" },
                    "\u7EC4\u540D\u79F0",
                    f.createElement("input", { autoFocus: true, maxLength: 100, required: true, className: "ccg-input", value: name, onChange: event => setName(event.target.value), disabled: status.busy, placeholder: "\u4F8B\u5982\uFF1A\u6750\u6599\u7814\u7A76" })),
                isPicker && f.createElement(CloudcliGroupSessionPicker, { group: action.group, selected: selected, setSelected: setSelected, busy: status.busy }),
                status.error && f.createElement("p", { role: "alert", className: "ccg-error" }, status.error),
                f.createElement("div", { className: "ccg-dialog-footer" },
                    f.createElement("button", { type: "button", className: "ccg-button", disabled: status.busy, onClick: onClose }, "\u53D6\u6D88"),
                    f.createElement("button", { className: 'ccg-button ' + (action.kind === 'delete' ? 'ccg-danger' : 'ccg-primary'), disabled: !valid || status.busy }, status.busy ? '保存中…' : action.kind === 'delete' ? '删除组' : isPicker ? `加入${selected.size ? ' ' + selected.size + ' 条' : ''}` : '保存')))));
}
function CloudcliGroupTarget({ target, setTarget, busy }) {
    const { groups, loading, error, reload } = useCloudcliGroups();
    return f.createElement("label", { className: "ccg-label" },
        "\u9009\u62E9\u7EC4",
        f.createElement("select", { className: "ccg-input", value: target, disabled: busy || loading, onChange: event => setTarget(event.target.value) },
            f.createElement("option", { value: "" }, "\u8BF7\u9009\u62E9"),
            groups.map(group => f.createElement("option", { key: group.id, value: group.id }, group.name)),
            f.createElement("option", { value: "__new" }, "\uFF0B \u521B\u5EFA\u65B0\u7EC4")),
        error && f.createElement("span", { role: "alert", className: "ccg-error" },
            error,
            f.createElement("button", { type: "button", onClick: reload }, "\u91CD\u8BD5")));
}
function CloudcliGroupSessionPicker({ group, selected, setSelected, busy }) {
    // Server-side search covers all indexed projects and older conversations, not loaded sidebar slices.
    const [query, setQuery] = f.useState('');
    // Holds only the current query's pages; stale requests are cancelled when the query changes.
    const [page, setPage] = f.useState({ rows: [], hasMore: false, total: 0, loading: true, error: '' });
    // A cursor represents a requested page; records keep their stable session IDs.
    const [offset, setOffset] = f.useState(0);
    // Retrying a failed page leaves existing rows and selections intact.
    const [retry, setRetry] = f.useState(0);
    const members = new Set(group.sessions.map(row => row.sessionId));
    f.useEffect(() => {
        const controller = new AbortController();
        setPage(previous => ({ ...previous, loading: true, error: '' }));
        const timer = setTimeout(() => {
            cloudcliGroupsApi.candidates(query, offset, controller.signal).then(data => {
                if (!controller.signal.aborted)
                    setPage(previous => ({ rows: offset ? [...new Map([...previous.rows, ...data.conversations].map(row => [row.sessionId, row])).values()] : data.conversations, hasMore: data.hasMore, total: data.total, loading: false, error: '' }));
            }).catch(error => { if (!controller.signal.aborted)
                setPage(previous => ({ ...previous, loading: false, error: error.message })); });
        }, 180);
        return () => { clearTimeout(timer); controller.abort(); };
    }, [query, offset, retry]);
    function toggle(id) { setSelected(current => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; }); }
    return f.createElement("div", { className: "ccg-picker" },
        f.createElement("label", { className: "ccg-label" },
            "\u641C\u7D22\u6240\u6709\u9879\u76EE\u7684\u5BF9\u8BDD",
            f.createElement("input", { autoFocus: true, className: "ccg-input", maxLength: 200, value: query, onChange: event => { setQuery(event.target.value); setOffset(0); setPage({ rows: [], hasMore: false, total: 0, loading: true, error: '' }); }, placeholder: "\u641C\u7D22\u5BF9\u8BDD\u540D\u79F0\u6216\u9879\u76EE\u2026" })),
        f.createElement("div", { className: "ccg-picker-info" },
            f.createElement("span", null,
                page.total,
                " \u6761\u5BF9\u8BDD"),
            f.createElement("span", null,
                "\u5DF2\u9009 ",
                selected.size,
                " / 100")),
        f.createElement("div", { className: "ccg-picker-list", "aria-busy": page.loading },
            page.rows.map(row => f.createElement("label", { key: row.sessionId, className: 'ccg-choice' + (members.has(row.sessionId) ? ' ccg-disabled' : ''), "data-group-choice": row.sessionId },
                f.createElement("input", { type: "checkbox", checked: members.has(row.sessionId) || selected.has(row.sessionId), disabled: busy || page.loading || members.has(row.sessionId) || (!selected.has(row.sessionId) && selected.size >= 100), onChange: () => toggle(row.sessionId) }),
                f.createElement(Ur, { provider: row.provider, className: "h-3.5 w-3.5" }),
                f.createElement("span", { className: "ccg-session-text" },
                    f.createElement("span", { className: "ccg-truncate", title: row.sessionTitle }, row.sessionTitle),
                    f.createElement("small", { className: "ccg-truncate", title: row.projectPath || '' },
                        row.projectDisplayName,
                        members.has(row.sessionId) ? ' · 已在组内' : '')))),
            page.loading && f.createElement("p", { role: "status", className: "ccg-hint ccg-inset" }, "\u6B63\u5728\u52A0\u8F7D\u2026"),
            !page.loading && !page.rows.length && !page.error && f.createElement("p", { className: "ccg-empty" }, "\u6CA1\u6709\u627E\u5230\u5BF9\u8BDD"),
            page.error && f.createElement("p", { role: "alert", className: "ccg-error" },
                page.error,
                f.createElement("button", { type: "button", onClick: () => setRetry(value => value + 1) }, "\u91CD\u8BD5")),
            page.hasMore && !page.loading && !page.error && f.createElement("button", { type: "button", className: "ccg-add-row", onClick: () => setOffset(page.rows.length) }, "\u52A0\u8F7D\u66F4\u591A\u5BF9\u8BDD")));
}
