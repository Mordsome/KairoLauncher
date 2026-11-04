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
   Azure account at https://azure.microsoft.com/free. That creates a directory with you as
   its administrator. Microsoft may ask for a phone number and a card to verify you're a
   person; app registrations themselves are free.

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
`xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`. The launcher reads it from its config file
(see the Phase 3 code: `config/auth.json`).

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
