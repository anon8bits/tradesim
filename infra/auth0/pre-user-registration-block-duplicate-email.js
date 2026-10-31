/**
 * Auth0 Action — trigger: Pre User Registration (runs for email/password
 * sign-ups on database connections; social logins never reach it).
 *
 * Refuses a new email/password sign-up when any existing Auth0 user (for
 * example a Google login) already has the same email, so the person sees
 * "already in use" on the sign-up form instead of creating a second login.
 * The TradeSim API enforces the same rule on POST /me (409 EMAIL_IN_USE),
 * which also covers the reverse case of Google after email/password.
 *
 * Setup (Auth0 dashboard):
 * 1. Applications → create a Machine to Machine app authorized for the
 *    Auth0 Management API with only the `read:users` scope.
 * 2. Actions → Library → Create Action → "Pre User Registration", paste this
 *    file, and add secrets DOMAIN (tenant domain, no https://), CLIENT_ID and
 *    CLIENT_SECRET from that M2M app. Deploy.
 * 3. Actions → Triggers → pre-user-registration → drag the Action in → Apply.
 */

const IN_USE_MESSAGE =
  "This email is already registered with TradeSim. Log in with the method you used before (for example, Continue with Google).";

exports.onExecutePreUserRegistration = async (event, api) => {
  const email = (event.user.email || "").trim().toLowerCase();
  if (!email) {
    return;
  }

  const { DOMAIN, CLIENT_ID, CLIENT_SECRET } = event.secrets;
  try {
    const tokenResponse = await fetch(`https://${DOMAIN}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "client_credentials",
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        audience: `https://${DOMAIN}/api/v2/`,
      }),
    });
    if (!tokenResponse.ok) {
      throw new Error(`token request failed: ${tokenResponse.status}`);
    }
    const { access_token: accessToken } = await tokenResponse.json();

    const usersResponse = await fetch(
      `https://${DOMAIN}/api/v2/users-by-email?email=${encodeURIComponent(email)}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!usersResponse.ok) {
      throw new Error(`users-by-email failed: ${usersResponse.status}`);
    }
    const users = await usersResponse.json();
    if (Array.isArray(users) && users.length > 0) {
      api.access.deny("email_in_use", IN_USE_MESSAGE);
    }
  } catch (error) {
    // Fail open: the API's POST /me check still refuses a duplicate email,
    // and an outage here should not block every new sign-up.
    console.log(`duplicate-email check skipped: ${error.message}`);
  }
};
