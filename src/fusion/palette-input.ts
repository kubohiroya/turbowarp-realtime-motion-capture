import { hsvFromHex } from "../markers/color.js";
export function validateGlowStickPerformer(performer: {
  performerId: string;
  glowStickColor: string;
}): void {
  if (!hsvFromHex(performer.glowStickColor)) {
    throw new Error(
      `Performer ${performer.performerId} has an invalid glow stick color.`,
    );
  }
}
