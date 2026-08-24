import registeredFunctions from "../../confect/_generated/registeredFunctions/integrations/slackConnections";

export const {
  authorizeSlackConnectCompletion,
  beginSlackConnect,
  claimSlackConnectAttempt,
  completeSlackConnect,
  finalizeSlackConnectAttempt,
  getSlackConnectionStatus,
  markSlackConnectAttemptFailed,
  prepareSlackConnectAttempt,
  reconcileSlackConnectSessionExpiry,
} = registeredFunctions;
