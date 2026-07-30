import React, { useCallback, useState } from 'react';
import { Modal } from 'react-native';
import PaywallScreen from '../screens/PaywallScreen';
import { AIFeature, requireAIAccess } from '../utils/proGate';

/**
 * One-line Pro gating for any screen that makes an AI call.
 *
 * Usage:
 *   const { requestAccess, paywall } = useAIGate();
 *   ...
 *   if (!(await requestAccess('food_photo'))) return;   // paywall shows itself
 *   ...
 *   return (<>{yourUI}{paywall}</>);
 *
 * Every AI surface needs the same three things — check entitlement, consume a
 * trial use, show the paywall with the right copy — and hand-rolling that in
 * each screen is how the gates drifted apart in the first place (8 of 14 AI
 * surfaces ended up with no gate at all). This keeps it to one call.
 */
export function useAIGate(onUnlocked?: () => void) {
  const [message, setMessage] = useState<string | null>(null);

  const requestAccess = useCallback(async (feature: AIFeature): Promise<boolean> => {
    const gate = await requireAIAccess(feature);
    if (gate.allowed) return true;
    setMessage(gate.message ?? 'Upgrade to Pro to keep using this feature.');
    return false;
  }, []);

  const close = useCallback(() => setMessage(null), []);

  const paywall = (
    <Modal
      visible={!!message}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={close}
    >
      <PaywallScreen
        onClose={close}
        onUnlock={() => { close(); onUnlocked?.(); }}
        trialMessage={message ?? undefined}
      />
    </Modal>
  );

  return { requestAccess, paywall, isPaywallVisible: !!message };
}

export default useAIGate;
