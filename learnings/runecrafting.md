# Runecrafting feeding (essence supply lines)

Verified 2026-10-24 with qweness1/qweness2 (bots that stockpile rune essence
and hand it to crafters at the altars).

## Rune essence mining in the Essence Mine

- The mine is the hidden zone m45_75 (x 2880-2943, z 4800-4863); enter only via
  a post-Rune-Mysteries wizard teleport: Aubury (Varrock, op4=Teleport) or
  Sedridor (tower basement, op3). Landing point is random among 22 enum coords.
- Exit: the "Portal" loc (op1 Use) inside the mine teleports you back to the
  wizard who sent you (server varp `%exit_essence_mine_coord`; falls back to
  Sedridor). Aubury exit lands ~(3253,3401) - literally at his shop door.
- **Rune essence does NOT stack** - one per inventory slot.
- **The "Rune Essence" rock does NOT deplete: ONE Mine op bulk-mines until the
  inventory is full** (~80s for 27 at Mining 1). It is interrupted only by
  Mining level-up dialogs - `dismissBlockingUI()` then re-send the op.
- SDK trap: while the bulk action runs, `bot.mineRock()` follow-ups return
  `success:false, reason:'rejected'` even though ore keeps arriving - gate
  loops on inventory/Xp deltas, not on the result (bug filed mvltjyh3-04af218b).
- Efficient loop: hub = Varrock east bank. Aubury (3252,3400) -> teleport ->
  bulk-mine -> portal -> bankers at (3253-3256,3418), open bank standing at
  (3253,3421); `openBank` from ~15 tiles away can report `no_bank_found`.

## Altar meet points (surface "Mysterious ruins", runecraft.dbrow altar_coord)

| Altar | Meet coords      | Notes                                        |
| ----- | ---------------- | -------------------------------------------- |
| air   | (2985, 3292)     | Lumbridge swamps side                        |
| mind  | (3014, 3514)     |                                              |
| water | (3185, 3165)     | Al Kharid (mine) side                        |
| earth | (3306, 3474)     |                                              |
| fire  | (3313, 3255)     | 41s walk E-Varrock hub -> ruins; return fine |
| body  | (3053, 3445)     |                                              |

- The temples are hidden zones; to craft you talisman-teleport in from the
  ruins. Feeders should MEET OUTSIDE the ruins - no talismans needed.
- chaos/nature/law ruins are surface points too (chaos is deep-wilderness,
  deadly to combat-3 bots); cosmic/death coords in dbrow are hidden-zone
  spots - use a DM'd "meet x,y" override for those.

## Coord format (server configs)

`level_regionX_regionZ_localX_localZ` -> absolute (regionX*64+localX,
regionZ*64+localZ). E.g. fire enter `0_40_75_16_48` -> (2576, 4848).

## Rune Mysteries quick-path (fresh bot, ~10 min, all levels 1)

1. New accounts spawn Lumbridge (3222,3218) with a 19-item starter kit
   (includes a bronze pickaxe) - skipTutorial first anyway.
2. Duke Horacio (3212,3220, CASTLE LEVEL 1; up-stair Staircase 1739 @
   (3204,3207), Climb-up=op1 from L0, Climb-down=op3 from L1).
   Dialog: "Have you any quests for me?" -> "Sure, no problem." = air talisman.
3. Wizards' Tower: ladder-top 2147 @ (3104,3162) behind door @ (3107,3162)
   (the door CLOSED behind q2 once - open nearby doors before retrying the
   climb). Climb-down -> basement (3104,9576); Sedridor @ (3103,9571).
   Dialog: "I'm looking for the head wizard." -> "Ok, here you are." ->
   "Yes, certainly." = research package.
4. Aubury (3252,3400) - hidden until you're at his door. Talk:
   "I have been sent here with a package for you." then talk AGAIN:
   "Ok then, I will do that." = research notes (he consumes the package).
5. Back to Sedridor with notes: dialog auto-completes (~20 pages, prefer
   /notes|research/ options). Reward: air talisman back + 250 xp; op3
   Teleport to Essence Mine unlocks on Sedridor/Aubury.

## Bot-to-bot / fleet coordination

- `sdk.dm(name, text)` reaches players anywhere in the world (chat type 3 for
  the receiver; sender echoes type 6). `GameMessage` field for the sender is
  **`m.sender`**, NOT `m.from` — reading `.from` silently matches nothing.
- FEEDER FLEET (qweness1-4): the whole fleet reacts to a command sent to ANY
  one bot. A command from wgelyjr (DM or public) sets the local trigger AND
  `broadcast()`s it (`RUN <altar>` / `STOP` / `MEET x,y`) to all peers; peers
  apply but never re-broadcast (one hop = full coverage, no storms).
  `freshCmd()` dedupes a command that arrives both directly (public, in-range)
  and relayed within a 45s window — re-issuing the same altar word after ~45s
  still works.
- Commands: an altar word (air/mind/water/earth/fire/body/cosmic/chaos/nature/
  law/death) switches ALL bots to delivery; stop/cancel/abort/never mind/stand
  down cancels every bot (each acks by DM); `meet x,y` overrides the point; a
  bare "come/run/essence" defaults to fire.
- Prime `getNewChat()` once at boot: the first call replays everything seen
  since connect and can false-trigger.

## Talisman acquisition (server-verified 2026-10-24)

| Talisman | Source on this server |
|---|---|
| air/mind/water/earth/fire/body | Rune Mysteries (air) + drops (dark wizards: water/fire 2/128; skeletons; vampires: earth 3/128) — GE listings exist but have no orders |
| nature | randomjewel drop table only: KBD (last roll), Mort Myre vampires (4/128 band), Catherby citizen (1/511). Ring of Wealth: denom 128->65. KBD lair z<6400 so it rolls nature, not chaos |
| chaos | randomjewel with the killing npc at z>6400 (deep wilderness) |
| law | **never drops and is untradeable.** Troll Stronghold reward; free replacement from Dunstan (Death Plateau anvil) when Troll complete + Death Plateau progress (death_get_map >= given_supplies) + none in bag. Ask "Can I have another law talisman?" |
| cosmic/death/blood/soul | not investigated — likely KBD ultrarare/death-table bands |

Implication for altar runs: nature/law deliveries need a character who has run
Troll Stronghold (law) or kills KBD/vampires (nature); no bank-and-go stock
pile is possible for them the way fire/water/earth/air/mind/body are.

## Restart hygiene

- Feeders are fully re-entrant: boot re-detects position (surface / mine /
  basement) and inventory, re-stows the kit, and rejoins the loop. Safe to
  kill and relaunch any time; the in-hand bag auto-banks.
- `pkill -f` self-matches the launching shell's own cmdline — kill in its own
  command with the `[s]` bracket trick, launch in a separate command.
