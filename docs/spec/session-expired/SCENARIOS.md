# session-expired — sequence diagrams

Participants are the seams a test probes: **App** (the shell), **Host**
(`OnlineHostPort`), **Pages** (`createOnlinePages`), **Session** (the host
session store), **GIS** (`OnlinePagesGis`), **API** (the injected `fetch`).
[Overview](./session-expired.md).

## 1. An expired token is signed out, with no request

```mermaid
sequenceDiagram
  participant App
  participant Host
  participant Session
  App->>Host: signedIn()
  Host->>Session: read token
  Note over Host: exp missing, not a number, or not after now
  Host->>Session: remove token
  Host-->>App: signedIn false, sessionExpired false
  Note over App: Sign in with Google, chooser slot offered, no session-expired note
  Note over Host: no authenticated request is sent
```

## 2. Create invite

One exchange. The 401 retry is the recovery of that same create, not a new
feature. `gis.prompt` on the 401 is once, because this token is an hour from
expiry, so the lead window does not also prompt.

```mermaid
sequenceDiagram
  participant App
  participant Host
  participant Pages
  participant Session
  participant GIS
  participant API
  App->>Host: createInvite()
  Host->>Pages: createInvite()
  Pages->>API: POST /invites, Bearer current token
  alt 200 or 201
    API-->>Pages: 201 token and seats
    Note over Pages: copiedUrl set, create note cleared
    Pages-->>App: resolved, pending false, link shown
  else 401
    API-->>Pages: 401
    Pages->>Session: remove token, forget socket
    Pages->>GIS: prompt()
    Note over Pages: sessionExpired true, held create armed, copiedUrl absent, create note absent
    Pages-->>App: resolved, pending false, signedIn false
    Note over App: Sign in with Google, session-expired note, chooser slot offered
    App->>Host: credential
    Host->>Pages: deliverGoogleCredential
    Pages->>Session: store credential, sessionExpired clear
    Note over Pages: held create cleared before the post
    Pages->>API: POST /invites once, plan and name now
    alt retry 201, lobby route, gates pass
      API-->>Pages: 201
      Pages->>API: GET /my-games
      Note over Pages: link shown, one library read
    else retry 401
      API-->>Pages: 401
      Note over Pages: sessionExpired true, no third POST, no library read
    else credential on an invite or game route
      Note over Pages: accept or game read, held create dropped, no POST /invites
    end
  else 422
    API-->>Pages: 422
    Note over Pages: refused sentence, plus reason only when the body has a non-empty reason
    Pages-->>App: resolved, pending false, link absent
  else other status or thrown fetch
    API--xPages: 500 or throw
    Note over Pages: failed sentence, promise resolves, sessionExpired unchanged
  end
```

## 3. My games

```mermaid
sequenceDiagram
  participant App
  participant Pages
  participant API
  App->>Pages: refreshLibrary()
  Pages->>API: GET /my-games
  alt 200 with zero games
    API-->>Pages: 200 empty games
    Note over Pages: library ready, libraryFailed false, empty copy applies
  else 401
    API-->>Pages: 401
    Note over Pages: token removed, sessionExpired true, libraryFailed false, not an empty success
  else other status, unparsed 200, or throw
    API--xPages: 500 or throw
    Note over Pages: libraryFailed true, sessionExpired false, not an empty success
  end
```

## 4. Any other authenticated 401

The invite peek with `auth: false` is not this exchange. A held submit is not
dropped. Hide, rename, load-more, version poll, and `GET /me` are the same door
as the alts drawn here.

```mermaid
sequenceDiagram
  participant App
  participant Pages
  participant API
  participant GIS
  App->>Pages: accept, start, read, export, delete, or submit
  Pages->>API: authenticated request
  API-->>Pages: 401
  Pages->>GIS: prompt()
  Note over Pages: token removed, sessionExpired true, the action's failure value
  alt the action was submitMoves
    Note over Pages: held submit kept, submitPending true, P95 unauthorized note unchanged
    App->>Pages: credential on that game route
    Pages->>API: POST /moves with the same submit id
    Note over Pages: held submit then clear
  else any other action
    Note over Pages: held submit, if any, stays held
  end
```

## 5. A user action inside the lead window

```mermaid
sequenceDiagram
  participant App
  participant Pages
  participant GIS
  participant API
  Note over Pages: token usable, exp minus now at most REAUTH_LEAD_MS, promptedFor does not name it
  App->>Pages: createInvite, accept, start, library, open, submit, export, delete, hide, rename, or load-more
  Pages->>GIS: prompt() once
  Pages->>API: the request, Bearer current token
  Note over Pages: does not wait for a new credential
```

## 6. promptedFor does not block a 401

```mermaid
sequenceDiagram
  participant App
  participant Pages
  participant GIS
  participant API
  Note over Pages: promptedFor already names this usable token
  App->>Pages: createInvite()
  Pages->>API: POST /invites, no extra proactive prompt
  API-->>Pages: 401
  Pages->>GIS: prompt() once for this 401
  Note over Pages: token removed, signedIn false, chooser slot offered, session-expired note
```
