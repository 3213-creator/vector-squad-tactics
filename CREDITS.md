# User-supplied 3D assets

- Map: **fps_tps Map**, credited in uploaded filename to **theking1322**.
- Local player appearance: **Soldier**, credited in uploaded filename to **Umair Yaqub**.
- Opponent appearance: **SWAT**, credited in uploaded filename to **Quaternius**.

Assets were supplied by the user as GLB files. The map was deduplicated and simplified for browser delivery; model materials and file attribution are retained. No license terms were supplied or inferred. The character appearances are relative to the viewer: each viewer sees themselves as Soldier and their opponent as SWAT.

## Audio

Gunfire: Vincent Sevedge / Tabasco, Gunshot Sounds, Creative Commons Attribution 3.0 per the source archive. Footsteps and grenade handling: HaelDB, CC0. Explosion: qubodup / Iwan Gabovitch, CC0. Sources and transformations are documented in public/audio/CREDITS.md, also served at /audio/credits and linked from the lobby.

## Title art and branding

The desert combat title background and metallic DEATH MATCH wordmark were generated from the visual references supplied by the user, then encoded as WebP for delivery. The original generated PNGs are retained separately in the working environment.


## User-supplied firearm models

The following nine GLB files are used for the actual first-person weapons. Their transparent WebP armory icons were rendered from these same models. Author names are taken from the uploaded filenames; no additional license terms were supplied or inferred.

| Game key | Uploaded asset | Credited author |
|---|---|---|
| rifle | Assault Rifle / Bgvuu4CUMV | Quaternius |
| rifle_z | Assault Rifle / XGeBGFQxYg | Zsky |
| smg_z | Submachine Gun / e66LWULNG4 | Zsky |
| smg_q | Submachine Gun / 7ehatxr7FY | Quaternius |
| sniper | Sniper Rifle / vGAzj2Of5M | J-Toastie |
| awp | AWP Sniper / fKsTWWhSkqt | Kyler Swanson |
| pistol | Pistol / J3i9KDQ3kt | Quaternius |
| pistol_z | Pistol / 3To2e7sKmO | Zsky |
| revolver | Revolver / 9C26wSpMS0 | Quaternius |


## Additional user-supplied motion and character edits

- Dying.fbx: supplied by the user. Its 4.4-second bone motion was sampled and retargeted to the SWAT-compatible rig, with ground-height correction, as dying.json.
- Rifle Idle.fbx: supplied by the user. Its 10.63-second motion was retargeted and sampled at 15 FPS for the lobby as rifle-idle.json.
- The Soldier appearance remains from the user's Soldier GLB. soldier-rigged.glb preserves its geometry/material appearance and adds skinning weights transferred from the uploaded Quaternius SWAT rig to support the supplied idle motion.
- Per-weapon sights and the held grenade are procedural additions based on the user's references. SWAT retains the original uploaded helmet/visor appearance; the custom face was removed at the user's request.

No additional license terms for the supplied FBX files were provided or inferred.
