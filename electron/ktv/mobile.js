// Localized, session-bound phone controls for searching and requesting Folia queue entries.
(() => {
    const $ = selector => document.querySelector(selector);
    const inviteStorageKey = 'folia-ktv-invite';
    const inviteUrl = new URL(location.href);
    const incomingToken = inviteUrl.searchParams.get('token') || new URLSearchParams(inviteUrl.hash.slice(1)).get('token') || '';
    const state = {
        session: incomingToken ? '' : sessionStorage.getItem('folia-ktv-session') || '',
        inviteToken: incomingToken || sessionStorage.getItem(inviteStorageKey) || '',
        busy: false, controlBusy: false, connected: false, snapshot: null,
        source: 'online', dictionary: {}, toastTimer: 0, announcedDisconnect: false, joining: false, searched: false,
    };
    const clearRoomCredentials = () => {
        state.session = '';
        state.inviteToken = '';
        sessionStorage.removeItem('folia-ktv-session');
        sessionStorage.removeItem(inviteStorageKey);
    };
    const fallback = {
        title: 'KTV 点歌', nowPlaying: '正在播放', currentSong: '当前歌曲', connecting: '正在连接桌面播放器…',
        sameWifi: '请确保手机和电脑连接同一 Wi-Fi', noSong: '还没有播放歌曲', chooseSong: '在下方搜索并点歌',
        search: '搜索并点歌', searchPlaceholder: '歌名或歌手', searchHint: '从 Folia 当前选择的平台或本地曲库搜索',
        searching: '正在搜索…', noResults: '没有找到歌曲，试试其他歌名或歌手', resultsHint: '找到 {count} 首 · 轻点「点歌」加入播放队列',
        requestSong: '点歌', adding: '添加中', added: '已点歌', queue: '播放队列', queueEmpty: '队列还是空的，点一首喜欢的歌吧',
        footer: '点歌发送到正在播放的 Folia 桌面端', original: '原唱播放', instrumental: '伴奏播放',
        online: '在线平台', local: '本地曲库', roomClosed: '点歌房已关闭或二维码已失效，请重新扫码',
        rateLimited: '操作太快了，请稍后再试', roomFull: '连接人数已满，请联系房主', timeout: '桌面端暂时没有响应，请稍后重试',
        unavailable: '歌曲暂时无法加入，请检查桌面端平台连接', forbidden: '无法连接此点歌房', invalidRequest: '请求无效，请重试',
        resultExpired: '搜索结果已过期，请重新搜索', external: '外部舞台正在播放，请联系房主切回 Folia',
        previous: '上一首', next: '下一首', play: '播放', pause: '暂停', enable: '自动生成当前歌曲伴奏', retry: '重新生成伴奏',
        buffer: '伴奏缓冲', engineHint: '优先使用 GPU；GPU 不可用或运行失败时自动切到 CPU。CPU 处理可能慢于实时播放，伴奏会随播放进度逐段生成。',
        status_idle: '等待选择歌曲', status_off: '伴奏生成未开启', status_loading: '正在读取音频并准备模型…',
        status_separating: '正在分段生成伴奏', status_ready: '整首伴奏已就绪', status_modelMissing: '缺少 HTDemucs 模型',
        status_gpuUnavailable: 'GPU 不可用，CPU 分离也无法运行', status_sourceUnavailable: '无法读取这首歌的完整音频',
        status_tooLong: '当前版本支持 10 分钟以内的歌曲', status_failed: '伴奏生成失败，可以重新尝试', status_external: '外部舞台正在播放',
    };
    const t = (key, vars = {}) => {
        let value = state.dictionary[key] || fallback[key] || key;
        for (const [name, replacement] of Object.entries(vars)) value = value.replace(`{${name}}`, String(replacement));
        return value;
    };
    const updatePlaybackControls = () => {
        const unavailable = !state.connected || state.controlBusy || state.snapshot?.external;
        const hasSong = Boolean(state.snapshot?.current);
        ['#previous-button', '#next-button', '#play-toggle'].forEach(selector => { $(selector).disabled = unavailable || !hasSong; });
        ['#mode-original', '#mode-instrumental', '#accompaniment-toggle', '#retry-accompaniment'].forEach(selector => { $(selector).disabled = unavailable; });
    };
    const randomOperationId = () => {
        const bytes = crypto.getRandomValues(new Uint8Array(16));
        return [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
    };
    const setConnected = connected => {
        state.connected = connected;
        $('#connection-label').textContent = connected ? 'HOME' : 'OFFLINE';
        $('#search-form').querySelectorAll('input,button').forEach(node => { node.disabled = !connected || state.busy; });
        $('#source-online').disabled = !connected;
        $('#source-local').disabled = !connected;
        updatePlaybackControls();
        if (connected) {
            state.announcedDisconnect = false;
            $('#search-form').hidden = false;
            $('.source-tabs').hidden = false;
        }
        else if (state.session && !state.announcedDisconnect) {
            state.announcedDisconnect = true;
            showToast(t('unavailable'));
        }
    };
    const showToast = text => {
        const toast = $('#toast');
        toast.textContent = text;
        toast.classList.add('show');
        clearTimeout(state.toastTimer);
        state.toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
    };
    const post = async (url, body) => {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(state.session ? { Authorization: `Bearer ${state.session}` } : {}) },
            body: JSON.stringify(body), cache: 'no-store',
        });
        const payload = await response.json();
        if (!response.ok || payload.ok !== true) throw new Error(payload.error || 'unavailable');
        return payload.data;
    };
    const updateLabels = dictionary => {
        if (dictionary) state.dictionary = dictionary;
        document.documentElement.lang = navigator.language || 'zh-CN';
        document.title = `Folia ${t('title')}`;
        $('#phone-title').textContent = t('title');
        $('#now-label').textContent = t('nowPlaying');
        $('#search-title').textContent = t('search');
        $('#query').placeholder = t('searchPlaceholder');
        $('#search-button').textContent = t('search');
        $('#search-button').setAttribute('aria-label', t('search'));
        $('#source-online').textContent = t('online');
        $('#source-local').textContent = t('local');
        $('#queue-title').textContent = t('queue');
        $('#phone-footer').textContent = t('footer');
        $('#previous-button').setAttribute('aria-label', t('previous'));
        $('#previous-button').title = t('previous');
        $('#next-button').setAttribute('aria-label', t('next'));
        $('#next-button').title = t('next');
        $('#mode-original').textContent = t('original');
        $('#mode-instrumental').textContent = t('instrumental');
        $('#enable-label').textContent = t('enable');
        $('#accompaniment-toggle').setAttribute('aria-label', t('enable'));
        $('#retry-accompaniment').textContent = t('retry');
        $('#accompaniment-buffer-label').textContent = t('buffer');
        $('#engine-hint').textContent = t('engineHint');
        if (!state.searched) $('#search-message').textContent = t('searchHint');
    };
    const errorText = code => t(Object.hasOwn(fallback, code) ? code : 'unavailable');
    const clock = value => {
        const seconds = Math.max(0, Math.floor(Number(value) || 0));
        return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    };
    const render = snapshot => {
        if (!snapshot) return;
        state.snapshot = snapshot;
        updateLabels(snapshot.dictionary);
        $('#provider-label').textContent = snapshot.onlineSource || '';
        $('#now-label').textContent = snapshot.playing ? t('nowPlaying') : t('currentSong');
        $('#now-title').textContent = snapshot.current?.title || t('noSong');
        $('#now-artist').textContent = snapshot.current?.artist || t('chooseSong');
        $('#now-mode').textContent = snapshot.audibleMode === 'instrumental' ? t('instrumental') : t('original');
        $('#now-time').textContent = `${clock(snapshot.position)} / ${clock(snapshot.current?.duration || 0)}`;
        $('#play-progress').value = snapshot.current?.duration ? Math.min(100, snapshot.position / snapshot.current.duration * 100) : 0;
        $('#play-toggle').textContent = snapshot.playing ? '⏸' : '▶';
        $('#play-toggle').setAttribute('aria-label', snapshot.playing ? t('pause') : t('play'));
        $('#play-toggle').title = snapshot.playing ? t('pause') : t('play');
        $('#mode-original').setAttribute('aria-pressed', String(snapshot.mode !== 'instrumental'));
        $('#mode-instrumental').setAttribute('aria-pressed', String(snapshot.mode === 'instrumental'));
        $('#accompaniment-toggle').setAttribute('aria-checked', String(Boolean(snapshot.enabled)));
        const preparation = snapshot.enabled ? snapshot.preparation : 'off';
        const preparationKey = `status_${preparation}`;
        const progress = snapshot.enabled ? Math.max(0, Math.min(100, Number(snapshot.progress) * 100 || 0)) : 0;
        const engine = snapshot.engine ? `${String(snapshot.engine).toUpperCase()} · ` : '';
        $('#accompaniment-status').textContent = `${engine}${t(preparationKey)}`;
        $('#accompaniment-progress-label').textContent = `${Math.round(progress)}%`;
        $('#accompaniment-progress').value = progress;
        $('#accompaniment-buffer').textContent = clock(snapshot.enabled ? snapshot.readySeconds : 0);
        $('#retry-accompaniment').hidden = !snapshot.enabled || !['failed', 'modelMissing', 'sourceUnavailable', 'gpuUnavailable'].includes(snapshot.preparation);
        const queue = $('#queue-list');
        $('#queue-count').textContent = String(snapshot.queue.length);
        queue.replaceChildren();
        if (!snapshot.queue.length) {
            const empty = document.createElement('li');
            empty.className = 'queue-empty';
            empty.textContent = t('queueEmpty');
            queue.append(empty);
        }
        snapshot.queue.slice(0, 10).forEach((song, index) => {
            const row = document.createElement('li');
            const number = document.createElement('span');
            number.className = 'queue-index';
            number.textContent = String(index + 1).padStart(2, '0');
            const copy = document.createElement('div');
            copy.className = 'queue-copy';
            const title = document.createElement('div');
            title.className = 'queue-title';
            title.textContent = song.title;
            const artist = document.createElement('div');
            artist.className = 'queue-artist';
            artist.textContent = song.artist;
            copy.append(title, artist);
            row.append(number, copy);
            queue.append(row);
        });
        updatePlaybackControls();
    };
    const join = async () => {
        if (state.session) {
            try {
                await refresh();
                return;
            } catch (error) {
                if (error.message !== 'roomClosed' || !state.inviteToken) throw error;
                state.session = '';
                sessionStorage.removeItem('folia-ktv-session');
            }
        }
        if (!state.inviteToken) throw new Error('roomClosed');
        const data = await post('/api/join', { token: state.inviteToken });
        state.session = data.sessionId;
        sessionStorage.setItem('folia-ktv-session', state.session);
        sessionStorage.setItem(inviteStorageKey, state.inviteToken);
        history.replaceState(null, '', location.pathname);
        setConnected(true);
        render(data.snapshot);
    };
    const refresh = async () => {
        if (!state.session) return;
        const response = await fetch('/api/snapshot', { headers: { Authorization: `Bearer ${state.session}` }, cache: 'no-store' });
        const payload = await response.json();
        if (!response.ok || payload.ok !== true) throw new Error(payload.error || 'roomClosed');
        setConnected(true);
        render(payload.data);
    };
    const search = async event => {
        event.preventDefault();
        if (state.busy || !state.connected) return;
        const query = $('#query').value.trim();
        if (!query) return;
        state.busy = true;
        state.searched = true;
        $('#results').replaceChildren();
        $('#search-message').textContent = t('searching');
        $('#search-button').disabled = true;
        try {
            const songs = await post('/api/request', { action: 'search', query, source: state.source });
            const results = $('#results');
            results.replaceChildren();
            $('#search-message').textContent = songs.length
                ? t('resultsHint', { count: songs.length }) : t('noResults');
            songs.forEach(song => {
                const row = document.createElement('article');
                row.className = 'result';
                const copy = document.createElement('div');
                copy.className = 'result-copy';
                const title = document.createElement('div');
                title.className = 'result-title';
                title.textContent = song.title;
                const artist = document.createElement('div');
                artist.className = 'result-artist';
                artist.textContent = song.artist;
                copy.append(title, artist);
                const button = document.createElement('button');
                button.className = 'add';
                button.type = 'button';
                button.textContent = t('requestSong');
                const operationId = randomOperationId();
                button.addEventListener('click', async () => {
                    if (button.disabled || !state.connected) return;
                    button.disabled = true;
                    button.textContent = t('adding');
                    try {
                        await post('/api/request', { action: 'enqueue', resultId: song.id, operationId });
                        button.textContent = t('added');
                        showToast(`✓ ${song.title}`);
                    } catch (error) {
                        button.disabled = false;
                        button.textContent = t('requestSong');
                        showToast(errorText(error.message));
                    }
                });
                row.append(copy, button);
                results.append(row);
            });
        } catch (error) {
            $('#search-message').textContent = errorText(error.message);
        } finally {
            state.busy = false;
            setConnected(state.connected);
        }
    };
    const control = async (action, value) => {
        if (state.controlBusy || !state.connected) return;
        state.controlBusy = true;
        updatePlaybackControls();
        try {
            await post('/api/control', { action, ...(value !== undefined ? { value } : {}) });
            await refresh();
        } catch (error) {
            showToast(errorText(error.message));
        } finally {
            state.controlBusy = false;
            updatePlaybackControls();
        }
    };
    $('#search-form').addEventListener('submit', search);
    $('#previous-button').addEventListener('click', () => { void control('previous'); });
    $('#next-button').addEventListener('click', () => { void control('next'); });
    $('#play-toggle').addEventListener('click', () => { void control('togglePlayback'); });
    $('#mode-original').addEventListener('click', () => { void control('setMode', 'original'); });
    $('#mode-instrumental').addEventListener('click', () => { void control('setMode', 'instrumental'); });
    $('#accompaniment-toggle').addEventListener('click', () => { void control('setEnabled', state.snapshot?.enabled !== true); });
    $('#retry-accompaniment').addEventListener('click', () => { void control('retry'); });
    for (const source of ['online', 'local']) {
        $(`#source-${source}`).addEventListener('click', () => {
            state.source = source;
            $('#source-online').setAttribute('aria-pressed', String(source === 'online'));
            $('#source-local').setAttribute('aria-pressed', String(source === 'local'));
        });
    }
    updateLabels();
    const reconnect = async () => {
        if (state.joining) return;
        state.joining = true;
        try { await join(); }
        catch (error) {
            setConnected(false);
            $('#now-title').textContent = errorText(error.message);
            $('#now-artist').textContent = t('sameWifi');
            if (error.message === 'roomClosed') {
                clearRoomCredentials();
            }
        } finally { state.joining = false; }
    };
    setConnected(false);
    void reconnect();
    setInterval(() => {
        if (!state.session && state.inviteToken) { void reconnect(); return; }
        void refresh().catch(error => {
        setConnected(false);
        if (error.message === 'roomClosed') {
            if (state.inviteToken) {
                // The invite is still usable even if the short-lived phone session expired.
                // Clear the session before reconnecting so the join flow goes straight to
                // /api/join instead of repeating the failing snapshot request.
                state.session = '';
                sessionStorage.removeItem('folia-ktv-session');
                void reconnect();
                return;
            }
            clearRoomCredentials();
            $('#now-title').textContent = errorText(error.message);
            $('#search-form').hidden = true;
            $('.source-tabs').hidden = true;
        }
        });
    }, 1800);
})();
