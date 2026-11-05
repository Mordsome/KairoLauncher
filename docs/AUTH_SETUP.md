# Setting up Microsoft sign-in

Kairo Launcher signs players in with their Microsoft account, the same way the official
launcher does. For that, Microsoft needs to know which app is asking: you register the
launcher once in Microsoft Entra (Azure) and get a **client ID**. Minecraft then only accepts
sign-ins from launchers Mojang has approved, so the client ID also goes through Mojang's review.

The client ID is not a secret. The launcher is a *public client*: it has no client secret,
it uses the authorization code flow with PKCE, and players type their password on Microsoft's
own page in their browser. The launcher never sees it.

## 1. Get a directory for your account (once)

A personal Microsoft account can only create app registrations inside a directory (a
"tenant") of its own.

1. Go to https://entra.microsoft.com and sign in.
2. Open **Identity → Applications → App registrations**.
3. If the page works, skip to step 2 of this guide.
4. If you get an error mentioning the *Microsoft Services* tenant, or no access, create a free
   Azure account at https://azure.microsoft.com/free ("Try Azure for free"). That creates a
   directory ("Default Directory") with you as its administrator. Microsoft asks for a phone
   number and a card only to verify you're a person; nothing is charged unless you upgrade to
   pay-as-you-go yourself, and app registrations are free. The directory and the registration
   stay after the 30-day trial ends; you can cancel the subscription and remove the card then.

Don't create a second directory under **Manage tenants**: new workforce tenants now need a paid
licence, and the *External* type doesn't support personal Microsoft accounts.

Tip: use a private browser window if the portal keeps signing you in to the wrong directory.

## 2. Register the app

In **App registrations → New registration**:

| Field | Value |
| --- | --- |
| Name | `Kairo Launcher` |
| Supported account types | **Personal Microsoft accounts only** |
| Redirect URI, platform | **Public client/native (mobile & desktop)** |
| Redirect URI, value | `http://localhost` |

Then press **Register**.

Notes:

- `http://localhost` is the "loopback" address. During sign-in the launcher listens on a random
  free port on your own PC for Microsoft's reply. Microsoft allows any port for this address.
- Don't create a client secret or a certificate. A desktop app can't keep one secret.
- No API permissions are needed. The launcher asks for `XboxLive.signin offline_access`
  when you sign in.
- The account type can't be changed later. If you picked the wrong one, delete the
  registration and make a new one.

## 3. Copy the client ID

On the registration's **Overview** page, copy **Application (client) ID**, a value like
`xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`, and put it in [`config/auth.json`](../config/auth.json).
It is built into the launcher; nothing else is needed.

Don't put the **tenant ID** in the launcher. It only goes to Mojang's review form (below). The
launcher signs in through Microsoft's shared `consumers` endpoint, so it never needs it, and
keeping it out means nobody can look up your directory's details from the app.

About the **publisher domain**: for apps like this one (personal accounts, registered after
November 2020), Microsoft's consent screen shows only "Unverified", not the publisher domain.
Your directory's `….onmicrosoft.com` name is never shown to players.

## 4. Ask Mojang to approve it

New client IDs can't sign in to Minecraft until Mojang approves them. Until then, sign-in
gets through Microsoft and then fails with **"Invalid app registration"**. The launcher
shows that message clearly instead of a generic error.

1. Open https://aka.ms/mce-reviewappid.
2. Fill in the client ID (and the tenant ID from the same Overview page, if asked), the
   launcher's name, and what it does: an open-source (GPL-3.0) launcher for the Kairo
   Minecraft clients, https://github.com/Mordsome/KairoLauncher.
3. The form asks for a contact email. Use one you're happy to have tied to the project.

Mojang reviews submissions **about once a week**. You get an email when the app is approved;
nothing in the launcher needs to change after that.

## How the launcher signs in

1. It opens `login.microsoftonline.com/consumers` in the player's browser (authorization code
   flow with PKCE, scopes `XboxLive.signin offline_access`). A small server on `localhost`, on a
   random port, waits for Microsoft to send the player back; it checks the `state` value and
   shuts down after one answer, a cancel, or 10 minutes.
2. MSAL exchanges the code for tokens. Then Xbox Live, XSTS, the Minecraft services login, the
   ownership check and the profile. Each failure has its own message (no Xbox profile, child
   account, no Minecraft, no player name, app not approved yet, network).
3. Tokens are stored only in the OS secure store (Windows Credential Manager, macOS Keychain,
   libsecret), split into pieces because Windows limits each entry to about 2.5 KB.
   `accounts.json` in the data folder holds only player names, UUIDs and which account plays.
4. Before each Play, the Minecraft token is refreshed silently if it's close to expiring.
   Signing an account out deletes its tokens. If sign-in gets through Microsoft but the account
   can't be added, its Microsoft tokens are deleted too.

Several accounts can be signed in at once; **Settings → Account** switches which one plays.
