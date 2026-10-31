# Midnight Garage art direction

Created October 31, 2026 using the built-in image_gen tool. Both assets ship locally; displaying them makes no generation or network requests. Original animation poses remain in jackshaft-sheet.png. The existing sprite sheet was the identity reference for the new portrait. No licensed game vehicle or official Rocket League artwork was used as a reference for these new assets.

## Shipped assets

- `app/renderer/assets/midnight-garage-v2.png`: cinematic haunted hot-rod workshop, used by the companion stage and secondary page headers.
- `app/renderer/assets/jackshaft-portrait-v2.png`: collectible Jackshaft portrait, used by the pit pass, identity avatar and Jackshaft personality card.
- Existing version-one assets are preserved for rollback. The dashboard loads the new scene; the transparent desktop overlay keeps its existing character animation and does not load the new scene texture.

## Final generation prompts

### Workshop

Use case: stylized-concept
Asset type: shipped desktop app background illustration, landscape 1536x1024.
Primary request: A spectacular original Halloween hot-rod repair garage for a vulgar but loyal pumpkin mechanic mascot. Premium cinematic stylized 3D game environment, highly crafted materials, playful haunted mechanical personality. No character in this image: the animated mascot is composited in the empty central foreground by the app.
Scene: a midnight roadside pit workshop, tall grimy arched garage bay, oxidized copper pipes, overhead hoist with a tiny pumpkin lantern, battered tool drawers and tire stacks at the sides. On the far left a compact original pumpkin-orange rocket-powered hot rod with hood open, finned exhaust, tiny glowing engine; NOT a recognizable licensed car. On the right a crooked battered petrol pump and hanging wrenches. Through the far rear doorway an enormous bone-yellow moon, distant crooked trees and teal mist.
Composition: straight-on eye-level wide environment, large empty concrete work floor in the central lower half for one foreground animated character. Dense beautiful detail at outer edges, quiet smoky dark center. Clear environmental depth, tangible objects, dramatic asymmetry. Use 3:2 landscape.
Lighting: warm amber work lamps and subtle ghostly teal rim lighting, cinematic soft shadows, golden dust in air. Dark burnt petrol, oxidized copper, warm tangerine and candlewax. Rich contrast, clear material detail.
Constraints: no people, no animals, no mascot, no writing, no lettering, no logos, no watermark, no UI, no labels. Avoid flat vector art, crayon texture, neon purple, generic sci-fi interface, excessive orange wash. Actual high-quality rendered scene, not a webpage mockup.

### Portrait

Use case: stylized-concept
Asset type: premium collectible character portrait for the RL Buddy desktop app, square.
Input image: the supplied eight-pose sheet is a character identity and material reference only. Produce one new close-up portrait, not another sheet.
Primary request: Jackshaft, the same mischievous pumpkin-headed goblin pit mechanic, in a dramatic shoulder-up portrait. Huge carved orange pumpkin head, crooked woody stalk, small green pointed ears, glowing amber eyes, one silver tooth in his filthy smug grin, greasy patched mechanic overalls, heavy work glove. One exhaust pipe behind shoulder. He holds a shiny small socket wrench casually beside his cheek like a cigar. Funny, cocky and affectionate, a midnight garage troublemaker.
Style: exceptionally polished stylized 3D game key art, sculpted pumpkin grooves and worn stitched fabric, rich physically rendered surfaces, no crayon or painterly sketch texture.
Framing: centered face filling the square, horns/stalk fully contained, dark petrol backdrop with a faint ring of oxidized copper behind the head, warm amber face light and cool misty teal edge light, dark corners. Sharp facial expression readable at small sizes.
Constraints: preserve reference character identity, no text, no lettering, no logos, no UI, no watermark. Exactly one head, one character, not a collage, no extra fingers. Background opaque dark petrol.
