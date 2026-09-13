// Shared PocketBase auth for joe.mt and its subdomains. Load after PocketBase.
(function (global) {
    'use strict';

    const COOKIE_NAME = 'joe_mt_users_auth';
    const INITIALIZED_COOKIE = 'joe_mt_users_auth_initialized';
    const COOKIE_DOMAIN = 'joe.mt';
    const ONE_YEAR = 60 * 60 * 24 * 365;

    function cookieValue(name, source = document.cookie) {
        const prefix = `${name}=`;
        const entry = source.split(';').map(part => part.trim()).find(part => part.startsWith(prefix));
        return entry ? entry.slice(prefix.length) : null;
    }

    function tokenPayload(token) {
        try {
            const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
            return JSON.parse(atob(base64));
        } catch (_) {
            return {};
        }
    }

    function validToken(token) {
        const payload = tokenPayload(token);
        return Object.keys(payload).length > 0 && (!payload.exp || payload.exp > Date.now() / 1000);
    }

    function isUserAuth(token, model) {
        return validToken(token) && model?.id && model.collectionName === 'users';
    }

    function cookieAttributes() {
        const host = global.location.hostname.toLowerCase();
        const sharedDomain = host === COOKIE_DOMAIN || host.endsWith(`.${COOKIE_DOMAIN}`);
        return `; Path=/; SameSite=Lax${sharedDomain ? `; Domain=${COOKIE_DOMAIN}` : ''}${global.location.protocol === 'https:' ? '; Secure' : ''}`;
    }

    function setInitialized() {
        document.cookie = `${INITIALIZED_COOKIE}=1; Max-Age=${ONE_YEAR}${cookieAttributes()}`;
    }

    function removeCookie() {
        document.cookie = `${COOKIE_NAME}=; Max-Age=0${cookieAttributes()}`;
        setInitialized();
    }

    function readAuth(source = document.cookie, key = COOKIE_NAME) {
        const raw = cookieValue(key, source);
        if (!raw) return null;
        try {
            const data = JSON.parse(decodeURIComponent(raw));
            const model = data.model || data.record;
            return isUserAuth(data.token, model) ? { token: data.token, model } : null;
        } catch (_) {
            return null;
        }
    }

    function cookieData(token, model) {
        let data = { token, model };
        if (encodeURIComponent(JSON.stringify(data)).length > 3800) {
            const { id, collectionId, collectionName, email, username, name, verified } = model;
            data = { token, model: { id, collectionId, collectionName, email, username, name, verified } };
        }
        if (encodeURIComponent(JSON.stringify(data)).length > 3800) {
            data = { token, model: { id: model.id, collectionId: model.collectionId, collectionName: 'users' } };
        }
        return encodeURIComponent(JSON.stringify(data));
    }

    function writeAuth(token, model) {
        const payload = tokenPayload(token);
        const expires = payload.exp ? `; Expires=${new Date(payload.exp * 1000).toUTCString()}` : '';
        document.cookie = `${COOKIE_NAME}=${cookieData(token, model)}${expires}${cookieAttributes()}`;
        setInitialized();
    }

    class Store {
        constructor() {
            this._token = '';
            this._model = null;
            this._listeners = new Set();

            const auth = readAuth();
            if (auth) {
                this._token = auth.token;
                this._model = auth.model;
            } else if (cookieValue(COOKIE_NAME) !== null) {
                removeCookie();
            } else if (cookieValue(INITIALIZED_COOKIE) === null) {
                // Move an existing users session out of PocketBase's origin-local store once.
                try {
                    const legacy = JSON.parse(global.localStorage.getItem('pocketbase_auth'));
                    const legacyModel = legacy.model || legacy.record;
                    if (isUserAuth(legacy.token, legacyModel)) {
                        this.save(legacy.token, legacyModel);
                        if (cookieValue(COOKIE_NAME) !== null) {
                            global.localStorage.removeItem('pocketbase_auth');
                        }
                    }
                } catch (_) { /* No legacy users session. */ }
            }

            global.addEventListener('focus', () => this.sync());
            global.addEventListener('pageshow', () => this.sync());
            document.addEventListener('visibilitychange', () => {
                if (!document.hidden) this.sync();
            });
        }

        get token() { return this._token; }
        get record() { return this._model; }
        get model() { return this._model; }
        get isValid() { return validToken(this._token); }
        get isAuthRecord() { return tokenPayload(this._token).type === 'authRecord'; }
        get isAdmin() { return tokenPayload(this._token).type === 'admin'; }
        get isSuperuser() { return false; }

        save(token, model) {
            this._token = token || '';
            this._model = model || null;
            if (isUserAuth(this._token, this._model)) {
                writeAuth(this._token, this._model);
            } else {
                removeCookie();
            }
            this._notify();
        }

        clear() {
            this.save('', null);
        }

        sync() {
            const auth = readAuth();
            const token = auth?.token || '';
            const model = auth?.model || null;
            if (token !== this._token || JSON.stringify(model) !== JSON.stringify(this._model)) {
                this._token = token;
                this._model = model;
                this._notify();
            }
        }

        onChange(callback, fireImmediately = false) {
            this._listeners.add(callback);
            if (fireImmediately) callback(this._token, this._model);
            return () => this._listeners.delete(callback);
        }

        loadFromCookie(source, key = COOKIE_NAME) {
            const auth = readAuth(source, key);
            this.save(auth?.token || '', auth?.model || null);
        }

        exportToCookie(options = {}, key = COOKIE_NAME) {
            const signedIn = isUserAuth(this._token, this._model);
            const attributes = `; Path=${options.path || '/'}; SameSite=${options.sameSite || 'Lax'}`;
            const domain = options.domain ? `; Domain=${options.domain}` : '';
            const secure = options.secure === false ? '' : '; Secure';
            const exp = tokenPayload(this._token).exp;
            const expires = signedIn ? (exp ? `; Expires=${new Date(exp * 1000).toUTCString()}` : '') : '; Max-Age=0';
            return `${key}=${signedIn ? cookieData(this._token, this._model) : ''}${attributes}${domain}${secure}${expires}`;
        }

        _notify() {
            for (const callback of this._listeners) callback(this._token, this._model);
        }
    }

    global.JoeSharedAuth = { Store };
})(window);
