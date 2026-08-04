<script lang="ts">
  // A faithful recreation of the in-game gem "Processing" window that DOUBLES AS THE INPUT FORM:
  // every value you'd read off a screenshot is the control that sets it (click a field -> a small
  // popover editor -> his constraintSnap re-normalizes and the DP re-ranks). Modelled on
  // shizukaziye's advisor-window.js interaction; visual ported from Sindhu's design (claude.ai/design
  // "Lost Ark Game Screen" / Processing.dc.html). Layout / colors mirror the game, Willpower red
  // (top), the two effects green (left) / blue (right) BY SLOT, Order/Chaos Points gold (bottom); the
  // top icon is the real per-type gem art; the name is tinted by rarity (uncommon green / rare blue /
  // epic purple). Fields the parser was unsure about (confidence < 0.8) glow amber to "please verify".
  // A comprehensive dropdown editor lives below as the manual backup. Both drive the same `edit` model.
  import { onMount } from 'svelte';
  import type {
    AdvisorOutcome,
    EditedAdvisorState,
    ParsedAdvisorState,
  } from '../../lib/advisor/advisorController';
  import type { ArkGridGemName } from '../../lib/models/arkGridGemSpecs';
  import { getGemImage } from '../../lib/models/arkGridGems';

  interface Props {
    parsed: ParsedAdvisorState;
    onEdit?: (edited: EditedAdvisorState) => void;
  }
  let { parsed, onEdit }: Props = $props();

  // ---- game constants (mirror of shizukaziye's frozen vendored model) ----------------------------
  const GEM_NAMES: Record<number, { order: string; chaos: string }> = {
    8: { order: 'Stability', chaos: 'Corrosion' },
    9: { order: 'Solidity', chaos: 'Distortion' },
    10: { order: 'Immutability', chaos: 'Destruction' },
  };
  const EFFECT_POOLS: Record<number, string[]> = {
    8: ['Additional Damage', 'Attack Power', 'Brand Power', 'Ally Damage Enh.'],
    9: ['Boss Damage', 'Attack Power', 'Ally Damage Enh.', 'Ally Attack Enh.'],
    10: ['Boss Damage', 'Additional Damage', 'Brand Power', 'Ally Attack Enh.'],
  };
  const RARITY_TURNS: Record<string, number> = { uncommon: 5, rare: 7, epic: 9 };
  const RARITY_REROLLS: Record<string, number> = { uncommon: 1, rare: 2, epic: 3 }; // model units
  const BASE_COSTS = [8, 9, 10];
  const LEVELS = [1, 2, 3, 4, 5];
  const RARITIES = ['uncommon', 'rare', 'epic'] as const;

  const SLOT = {
    wp: { color: '#d43414', glow: 'rgba(230,70,30,.45)' },
    e1: { color: '#3f9c1e', glow: 'rgba(110,200,40,.4)' },
    e2: { color: '#1f66c4', glow: 'rgba(60,140,230,.45)' },
    pts: { color: '#d68a1e', glow: 'rgba(230,160,40,.45)' },
    neutral: { color: '#8b93a3', glow: 'rgba(150,160,180,.3)' },
  };
  const RARITY_TINT: Record<string, { color: string; glow: string }> = {
    uncommon: { color: '#63b84a', glow: 'rgba(99,184,74,.5)' },
    rare: { color: '#4ea3e6', glow: 'rgba(78,163,230,.55)' },
    epic: { color: '#bd6fe6', glow: 'rgba(150,90,220,.55)' },
  };
  const abbr = (n: string) => (n === 'Attack Power' ? 'Atk. Power' : n);

  // ---- manual-edit model: the SINGLE source of truth for the readout (instant, local) and the
  // advice (async, via onEdit -> the worker DP). Rendering from `edit`, not the worker's echo, is
  // what makes clicks feel instant; the ~half-second DP only gates the advice table, not the visual.
  type Edit = {
    gemType: string;
    baseCost: number;
    rarity: string;
    willpowerLevel: number;
    orderLevel: number;
    effect1: string;
    effect1Level: number;
    effect2: string;
    effect2Level: number;
    currentTurn: number;
    rerollFree: number;
    resetAvail: number;
    costMult: number;
    outcomes: { type: string; target: string; amount: number; change: number }[];
  };
  let editing = $state(false);
  let edit = $state<Edit>(seedEdit(parsed));
  function seedEdit(p: ParsedAdvisorState): Edit {
    const rr = p.rarity ?? (p.state.maxTurns <= 5 ? 'uncommon' : p.state.maxTurns <= 7 ? 'rare' : 'epic');
    return {
      gemType: p.config.gemType,
      baseCost: p.config.baseCost,
      rarity: rr,
      willpowerLevel: p.config.willpowerLevel,
      orderLevel: p.config.orderLevel,
      effect1: p.config.effect1,
      effect1Level: p.config.effect1Level,
      effect2: p.config.effect2,
      effect2Level: p.config.effect2Level,
      currentTurn: p.state.currentTurn,
      rerollFree: Math.max(0, (p.state.rerollsRemaining ?? 0) - 1),
      resetAvail: p.state.resetsRemaining === 0 ? 0 : 1,
      costMult: p.state.processCostMultiplier ?? 0,
      outcomes: p.outcomes.map((o) => ({
        type: o.type,
        target: o.target ?? 'willpower',
        amount: o.amount ?? 1,
        change: o.change ?? (o.type === 'change_gold_cost' ? -100 : 1),
      })),
    };
  }
  // Local mirror of his constraintSnap, keeps the instantly-rendered gem legal after every edit
  // (effects snap into the base-cost pool + stay distinct; levels/turn/rerolls clamp to the rarity).
  function normalizeEdit(e: Edit) {
    if (!BASE_COSTS.includes(e.baseCost)) e.baseCost = 9;
    const pool = EFFECT_POOLS[e.baseCost] ?? [];
    if (!pool.includes(e.effect1)) e.effect1 = pool[0];
    if (!pool.includes(e.effect2) || e.effect2 === e.effect1)
      e.effect2 = pool.find((p) => p !== e.effect1) ?? pool[0];
    const clampLv = (v: number) => Math.max(1, Math.min(5, v));
    e.willpowerLevel = clampLv(e.willpowerLevel);
    e.orderLevel = clampLv(e.orderLevel);
    e.effect1Level = clampLv(e.effect1Level);
    e.effect2Level = clampLv(e.effect2Level);
    e.currentTurn = Math.max(1, Math.min(RARITY_TURNS[e.rarity] ?? 9, e.currentTurn));
    e.rerollFree = Math.max(0, Math.min((RARITY_REROLLS[e.rarity] ?? 3) - 1, e.rerollFree));
    e.costMult = e.costMult >= 50 ? 100 : e.costMult <= -50 ? -100 : 0;
    e.resetAvail = e.resetAvail === 0 ? 0 : 1;
  }

  // Confidence flags are LOCAL: seeded from the parse, cleared once you start hand-setting the gem.
  type Conf = { config?: Record<string, number>; state?: Record<string, number>; outcomes?: number[] };
  function seedUnconfirmed(p: ParsedAdvisorState): Record<string, true> {
    const u: Record<string, true> = {};
    const cf = (p.confidence ?? null) as Conf | null;
    if (cf?.config)
      for (const k of Object.keys(cf.config)) if ((cf.config[k] ?? 1) < 0.8) u['config.' + k] = true;
    if (cf?.outcomes) cf.outcomes.forEach((v, i) => (v != null && v < 0.8 ? (u['outcomes.' + i] = true) : 0));
    // The processing cost is the one STATE field worth flagging like a config field. When the reader
    // cannot find it the snap does not leave a hole, it substitutes the 900 base, so an unread cost is
    // indistinguishable on screen from a confident one — and it is not cosmetic, every gold figure in
    // the advice is computed from it. The other state fields stay out: they have no highlight target
    // here, and a count that exceeds what is highlighted just looks like a bug.
    if ((cf?.state?.processCostMultiplier ?? 1) < 0.8) u['state.cost'] = true;
    return u;
  }
  let unconfirmed = $state<Record<string, true>>(seedUnconfirmed(parsed));
  const lowConfig = (f: string) => !!unconfirmed['config.' + f];
  const lowOutcome = (i: number) => !!unconfirmed['outcomes.' + i];
  const lowCost = () => !!unconfirmed['state.cost'];

  // A fresh parse (upload / live frame / default) reseeds; an advice echo does NOT, the Panel keeps
  // the `parsed` prop stable across manual edits, so hand-set values are never stomped.
  $effect(() => {
    void parsed;
    edit = seedEdit(parsed);
    unconfirmed = seedUnconfirmed(parsed);
  });
  // Every edit: keep the gem legal, drop the "verify me" flags, then fire the async re-advise.
  function commit() {
    normalizeEdit(edit);
    unconfirmed = {};
    emit();
  }
  // "Start a fresh cut": keep the gem's identity (type / gem / rarity / effect names) but return every
  // progress field to an unprocessed state. Turn and reroll counts follow the rarity (a fresh epic is
  // 9/9 with 2 free rerolls; a fresh uncommon is 5/5 with 0), and the Reset counter returns to 1/1.
  function resetToFresh() {
    edit.willpowerLevel = 1;
    edit.orderLevel = 1;
    edit.effect1Level = 1;
    edit.effect2Level = 1;
    edit.currentTurn = 1; // attemptsShown = maxTurns for the rarity
    edit.rerollFree = (RARITY_REROLLS[edit.rarity] ?? 3) - 1;
    edit.resetAvail = 1;
    edit.costMult = 0;
    edit.outcomes = edit.outcomes.map(() => ({ type: 'do_nothing', target: 'willpower', amount: 1, change: 1 }));
    commit();
  }

  // ---- derived readout (LOCAL, instant; the advice re-ranks asynchronously) ----------------------
  let isChaos = $derived(edit.gemType === 'chaos');
  let rarity = $derived(edit.rarity);
  let pointsSum = $derived(
    edit.willpowerLevel + edit.orderLevel + edit.effect1Level + edit.effect2Level
  );
  let gemName = $derived(GEM_NAMES[edit.baseCost]?.[isChaos ? 'chaos' : 'order'] ?? '');
  let gemFullName = $derived(
    `${isChaos ? 'Chaos' : 'Order'} Astrogem: ${gemName}` as ArkGridGemName
  );
  let gemIconSrc = $derived(getGemImage(isChaos ? 'Chaos' : 'Order', gemFullName));
  let nameTint = $derived(RARITY_TINT[rarity] ?? RARITY_TINT.epic);

  let resetLeft = $derived(edit.resetAvail);
  let resetUsed = $derived(edit.resetAvail === 0);
  let rerollFreeMax = $derived((RARITY_REROLLS[rarity] ?? 3) - 1);
  let rerollFreeLeft = $derived(edit.rerollFree);
  let processCost = $derived(Math.max(0, Math.round(900 * (1 + edit.costMult / 100))));
  let maxTurns = $derived(RARITY_TURNS[rarity] ?? 9);
  // The game's "Process (x/N)" shows attempts REMAINING (a fresh gem is full: 9/9), not the turn index.
  let attemptsShown = $derived(maxTurns - edit.currentTurn + 1);

  let flaggedCount = $derived(
    [
      lowConfig('willpowerLevel'),
      lowConfig('orderLevel'),
      lowConfig('effect1'),
      lowConfig('effect1Level'),
      lowConfig('effect2'),
      lowConfig('effect2Level'),
      lowConfig('baseCost'),
      lowConfig('gemType'),
      lowCost(),
      ...parsed.outcomes.map((_, i) => lowOutcome(i)),
    ].filter(Boolean).length
  );
  let pointsFlagged = $derived(
    lowConfig('willpowerLevel') ||
      lowConfig('orderLevel') ||
      lowConfig('effect1Level') ||
      lowConfig('effect2Level')
  );

  // ---- the four dial gems ------------------------------------------------------------------------
  const CORNERS = ['tr', 'br', 'bl', 'tl'] as const;
  let centerGems = $derived([
    {
      slot: 'wp' as const,
      pop: 'level' as const,
      field: 'willpowerLevel' as const,
      label: 'Willpower Efficiency',
      val: `${edit.willpowerLevel}`,
      big: true,
      x: '255px',
      y: '26px',
      flag: lowConfig('willpowerLevel'),
    },
    {
      slot: 'e1' as const,
      pop: 'effect1' as const,
      field: 'effect1Level' as const,
      label: abbr(edit.effect1),
      val: `Lv. ${edit.effect1Level}`,
      big: false,
      x: '132px',
      y: '121px',
      flag: lowConfig('effect1') || lowConfig('effect1Level'),
    },
    {
      slot: 'e2' as const,
      pop: 'effect2' as const,
      field: 'effect2Level' as const,
      label: abbr(edit.effect2),
      val: `Lv. ${edit.effect2Level}`,
      big: false,
      x: '378px',
      y: '121px',
      flag: lowConfig('effect2') || lowConfig('effect2Level'),
    },
    {
      slot: 'pts' as const,
      pop: 'level' as const,
      field: 'orderLevel' as const,
      label: `${isChaos ? 'Chaos' : 'Order'} Points`,
      val: `${edit.orderLevel}`,
      big: true,
      x: '255px',
      y: '216px',
      flag: lowConfig('orderLevel'),
    },
  ]);

  // ---- outcomes ----------------------------------------------------------------------------------
  const statName = (target: string | undefined): string => {
    if (target === 'willpower') return 'Willpower Efficiency';
    if (target === 'order') return isChaos ? 'Chaos Points' : 'Order Points';
    if (target === 'effect1') return abbr(edit.effect1);
    if (target === 'effect2') return abbr(edit.effect2);
    return target ?? '';
  };
  const slotOf = (target: string | undefined) =>
    target === 'effect1'
      ? 'e1'
      : target === 'effect2'
        ? 'e2'
        : target === 'willpower'
          ? 'wp'
          : target === 'order'
            ? 'pts'
            : 'neutral';
  function outcomeView(o: AdvisorOutcome, i: number) {
    const slot = slotOf(o.target) as keyof typeof SLOT;
    const sc = SLOT[slot];
    const flag = lowOutcome(i);
    switch (o.type) {
      case 'raise_effect':
      case 'lower_effect': {
        const up = o.type === 'raise_effect';
        const isEffect = o.target === 'effect1' || o.target === 'effect2';
        const amt = o.amount ?? 1;
        return {
          label: statName(o.target),
          val: isEffect ? `Lv. ${amt}` : `${up ? '+' : '-'}${amt}`,
          arrow: up ? '▲' : '▼',
          arrowColor: up ? '#57c15a' : '#e04b3a',
          color: sc.color,
          glow: sc.glow,
          flag,
        };
      }
      case 'change_side_option':
        return { label: statName(o.target), val: 'Effect Changed', arrow: '', arrowColor: 'transparent', color: sc.color, glow: sc.glow, flag };
      case 'change_gold_cost': {
        const ch = o.change ?? 0;
        return { label: 'Processing Cost', val: `${ch >= 0 ? '+' : ''}${ch}%`, arrow: '', arrowColor: 'transparent', color: SLOT.neutral.color, glow: SLOT.neutral.glow, flag };
      }
      case 'reroll_increase':
        return { label: 'View Other Items', val: `+${o.change ?? 1} times`, arrow: '', arrowColor: 'transparent', color: SLOT.neutral.color, glow: SLOT.neutral.glow, flag };
      default:
        return { label: 'None', val: 'tap to set', arrow: '', arrowColor: 'transparent', color: SLOT.neutral.color, glow: SLOT.neutral.glow, flag };
    }
  }
  let outcomeViews = $derived(edit.outcomes.map((o, i) => outcomeView(o, i)));

  const OUTCOME_KINDS = [
    { type: 'raise_effect', label: 'Raise' },
    { type: 'lower_effect', label: 'Lower' },
    { type: 'change_side_option', label: 'Change effect' },
    { type: 'change_gold_cost', label: 'Cost change' },
    { type: 'reroll_increase', label: 'Extra rerolls' },
    { type: 'do_nothing', label: 'Nothing' },
  ];
  const targetLabel = (t: string) =>
    t === 'willpower'
      ? 'Willpower'
      : t === 'order'
        ? edit.gemType === 'chaos'
          ? 'Chaos Points'
          : 'Order Points'
        : t === 'effect1'
          ? abbr(edit.effect1)
          : abbr(edit.effect2);

  function rawOutcome(o: Edit['outcomes'][number]): AdvisorOutcome {
    switch (o.type) {
      case 'raise_effect':
      case 'lower_effect':
        return { type: o.type, target: o.target, amount: o.amount };
      case 'change_side_option':
        return { type: 'change_side_option', target: o.target === 'effect2' ? 'effect2' : 'effect1' };
      case 'change_gold_cost':
        return { type: 'change_gold_cost', change: o.change >= 0 ? 100 : -100 };
      case 'reroll_increase':
        return { type: 'reroll_increase', change: o.change >= 2 ? 2 : 1 };
      default:
        return { type: 'do_nothing' };
    }
  }
  function emit() {
    if (!onEdit) return;
    onEdit({
      config: {
        baseCost: edit.baseCost,
        gemType: edit.gemType,
        willpowerLevel: edit.willpowerLevel,
        orderLevel: edit.orderLevel,
        effect1: edit.effect1,
        effect1Level: edit.effect1Level,
        effect2: edit.effect2,
        effect2Level: edit.effect2Level,
      },
      state: {
        currentTurn: edit.currentTurn,
        maxTurns: RARITY_TURNS[edit.rarity] ?? 9,
        rerollsShownFree: edit.rerollFree,
        resetsRemaining: edit.resetAvail,
        processCostMultiplier: edit.costMult,
        rosterBound: parsed.state.rosterBound ?? false,
      },
      outcomes: edit.outcomes.map(rawOutcome),
      rarity: edit.rarity,
    });
  }

  // ---- click-to-edit popovers (the visual IS the form) -------------------------------------------
  type Pop =
    | { kind: 'identity' }
    | { kind: 'level'; field: 'willpowerLevel' | 'orderLevel' }
    | { kind: 'effect'; which: 'effect1' | 'effect2' }
    | { kind: 'turn' }
    | { kind: 'rerolls' }
    | { kind: 'cost' }
    | { kind: 'reset' }
    | { kind: 'outcome'; i: number };
  let pop = $state<(Pop & { top: number; left: number; up: boolean }) | null>(null);

  function openPop(p: Pop, ev: MouseEvent) {
    const el = ev.currentTarget as HTMLElement;
    const r = el.getBoundingClientRect();
    const up = r.top > window.innerHeight * 0.55;
    const left = Math.max(8, Math.min(window.innerWidth - 260, r.left + r.width / 2 - 120));
    const off = up ? window.innerHeight - r.top + 8 : r.bottom + 8;
    pop = { ...p, top: off, left, up };
  }
  function closePop() {
    pop = null;
  }
  // A popover selection mutates `edit`, normalizes + repaints instantly, then re-advises async.
  function pick(mutate: () => void, keepOpen = false) {
    mutate();
    commit();
    if (!keepOpen) closePop();
  }
  const effectDisabled = (which: 'effect1' | 'effect2', name: string) =>
    name === edit[which === 'effect1' ? 'effect2' : 'effect1'];
  function setOutcome(i: number, o: Partial<Edit['outcomes'][number]> & { type: string }) {
    edit.outcomes[i] = {
      type: o.type,
      target: o.target ?? edit.outcomes[i].target,
      amount: o.amount ?? edit.outcomes[i].amount,
      change: o.change ?? edit.outcomes[i].change,
    };
    commit();
    closePop();
  }
  // outcome-editor option groups for a target diamond
  const OUT_TARGETS = ['willpower', 'order', 'effect1', 'effect2'] as const;
  const levelOf = (t: string) =>
    t === 'willpower'
      ? edit.willpowerLevel
      : t === 'order'
        ? edit.orderLevel
        : t === 'effect1'
          ? edit.effect1Level
          : edit.effect2Level;

  // ---- scale-to-fit (the 760px panel shrinks into whatever column it lands in) --------------------
  let stageEl: HTMLDivElement | undefined = $state();
  let panelEl: HTMLDivElement | undefined = $state();
  let scale = $state(0.5);
  function fit() {
    if (!stageEl || !panelEl) return;
    scale = Math.min(Math.max(stageEl.clientWidth / 760, 0.3), 1);
    stageEl.style.height = panelEl.offsetHeight * scale + 'px';
  }
  onMount(() => {
    void import('@fontsource/cinzel/latin-500.css');
    void import('@fontsource/cinzel/latin-600.css');
    void import('@fontsource/cinzel/latin-700.css');
    void import('@fontsource/eb-garamond/latin-400.css');
    const ro = new ResizeObserver(fit);
    ro.observe(stageEl!);
    requestAnimationFrame(fit);
    const t = setTimeout(fit, 400);
    const onScroll = () => closePop();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closePop();
    };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('keydown', onKey);
    return () => {
      ro.disconnect();
      clearTimeout(t);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('keydown', onKey);
    };
  });
  $effect(() => {
    void parsed;
    queueMicrotask(fit);
  });
</script>

<div class="pw-card" data-testid="processing-window">
  {#if onEdit}
    <button
      type="button"
      class="pw-fresh"
      title="Start a fresh cut (keeps the gem; resets levels, turn, rerolls, and the reset counter)"
      aria-label="Start a fresh cut"
      onclick={resetToFresh}
    >
      ↺
    </button>
  {/if}
  <div class="pw-stage" bind:this={stageEl}>
    <div class="pw-nebula" aria-hidden="true"></div>
    <div class="pw-panel" bind:this={panelEl} style="transform: translateX(-50%) scale({scale});">
      <div class="pw-vignette" aria-hidden="true"></div>
      <div class="pw-inner">
        <div class="pw-titlerow">
          <span class="pw-rule left"></span>
          <span class="pw-title">Processing</span>
          <span class="pw-rule right"></span>
        </div>

        <!-- real per-type gem icon; click = the whole gem identity (type + gem + rarity) -->
        <div class="pw-iconrow">
          <button
            type="button"
            class="pw-icon"
            style="border-color:{nameTint.color}; box-shadow:0 0 14px {nameTint.glow}, 0 4px 14px rgba(0,0,0,.6);"
            title="Click to set the gem, type, and rarity"
            onclick={(e) => openPop({ kind: 'identity' }, e)}
          >
            <img class="pw-icon-img" src={gemIconSrc} alt="{isChaos ? 'Chaos' : 'Order'} Astrogem: {gemName}" />
            <span class="pw-icon-cog" aria-hidden="true">⚙</span>
          </button>
        </div>

        <!-- name; click = the whole gem identity (type + gem + rarity) -->
        <button
          type="button"
          class="pw-name pw-edit"
          class:flag={lowConfig('gemType') || lowConfig('baseCost')}
          style="color:{nameTint.color}; text-shadow:0 0 12px {nameTint.glow};"
          title="Click to set the gem, type, and rarity"
          onclick={(e) => openPop({ kind: 'identity' }, e)}
        >
          {isChaos ? 'Chaos' : 'Order'} Astrogem{gemName ? `: ${gemName}` : ''}
        </button>
        <div class="pw-divider" aria-hidden="true">
          <span class="d-rule"></span><span class="d-dot"></span><span class="d-rule"></span>
        </div>

        <div class="pw-points" class:flag={pointsFlagged}>
          <span>{pointsSum} Astrogem Points</span>
          <span class="pw-help" title="The four levels summed. Check it against the number the game shows.">?</span>
        </div>

        <!-- reset; click = available/used -->
        <div class="pw-resetrow">
          <button type="button" class="pw-reset pw-edit" class:used={resetUsed} title="Click to set the Reset counter" onclick={(e) => openPop({ kind: 'reset' }, e)}>
            Reset {resetLeft}/1
          </button>
        </div>

        <!-- arcane dial + gems -->
        <div class="pw-wheel">
          <div class="ring ring-fade" aria-hidden="true"></div>
          <div class="ring ring-border" aria-hidden="true"></div>
          <div class="ring ring-tick-outer" aria-hidden="true"></div>
          <div class="ring ring-tick-inner" aria-hidden="true"></div>
          <div class="ring ring-hair" aria-hidden="true"></div>
          <div class="ring ring-core" aria-hidden="true"></div>

          {#each centerGems as g (g.slot)}
            <button
              type="button"
              class="pw-gem pw-edit"
              class:flag={g.flag}
              style="left:{g.x}; top:{g.y};"
              title={g.pop === 'level' ? 'Click to set the level' : 'Click to set the effect and level'}
              onclick={(e) =>
                g.pop === 'level'
                  ? openPop({ kind: 'level', field: g.field as 'willpowerLevel' | 'orderLevel' }, e)
                  : openPop({ kind: 'effect', which: g.pop }, e)}
            >
              {#each CORNERS as corner (corner)}
                <span class="gem-spike {corner}"></span>
              {/each}
              <span class="gem-frame"></span>
              <span class="gem-groove"></span>
              <span class="gem-body" style="background:{SLOT[g.slot].color}; box-shadow:0 0 18px {SLOT[g.slot].glow};"></span>
              <span class="gem-label">
                <span class="gem-name">{g.label}</span>
                <span class="gem-val" class:big={g.big}>{g.val}</span>
              </span>
            </button>
          {/each}
        </div>

        <div class="pw-hint">One of the following is randomly applied.</div>

        <!-- outcomes; click each = one-tap editor -->
        <div class="pw-outcomerow">
          <div class="pw-outcomes">
            {#each outcomeViews as o, i (i)}
              <button type="button" class="pw-oc pw-edit" class:flag={o.flag} title="Click to set this outcome" onclick={(e) => openPop({ kind: 'outcome', i }, e)}>
                <span class="oc-diamond">
                  {#each CORNERS as corner (corner)}
                    <span class="oc-spike {corner}"></span>
                  {/each}
                  <span class="oc-body" style="background:{o.color}; box-shadow:0 0 9px {o.glow};"></span>
                </span>
                <span class="oc-text">
                  <span class="oc-label">{o.label}</span>
                  <span class="oc-val">
                    <span class="oc-num">{o.val}</span>
                    {#if o.arrow}<span class="oc-arrow" style="color:{o.arrowColor};">{o.arrow}</span>{/if}
                  </span>
                </span>
              </button>
            {/each}
          </div>
          <div class="pw-reroll">
            <button type="button" class="reroll-btn" title="Click to set free rerolls" onclick={(e) => openPop({ kind: 'rerolls' }, e)}>
              <span class="reroll-word">Reroll</span>
              <span class="reroll-num">{rerollFreeLeft}/{rerollFreeMax}</span>
            </button>
          </div>
        </div>

        <div class="pw-hairline" aria-hidden="true"></div>

        <!-- cost; click = 0 / 900 / 1,800 -->
        <div class="pw-costrow">
          <span>Processing Cost</span>
          <button type="button" class="pw-cost-val pw-edit" class:flag={lowCost()} title={lowCost() ? "The reader couldn't confirm the processing cost — check it, every gold figure in the advice depends on it" : 'Click to set the processing cost'} onclick={(e) => openPop({ kind: 'cost' }, e)}>
            {processCost.toLocaleString()}<span class="pw-coin"></span>
          </button>
        </div>

        <div class="pw-buttons">
          <div class="pw-btn complete">Processing Complete</div>
          <button type="button" class="pw-btn process pw-edit" title="Click to set the current turn" onclick={(e) => openPop({ kind: 'turn' }, e)}>
            Process ({attemptsShown}/{maxTurns})
          </button>
        </div>
      </div>
    </div>
  </div>

  {#if flaggedCount > 0 || parsed.ocrDegraded}
    <div class="pw-confstrip">
      {#if parsed.ocrDegraded}
        Low-confidence read: click the highlighted fields to fix them, or use the dropdowns below.
      {:else}
        {flaggedCount} field{flaggedCount > 1 ? 's' : ''} to double-check (highlighted). Click any to fix it.
      {/if}
    </div>
  {/if}

  <!-- popover editors (fixed-position; a backdrop closes them) -->
  {#if pop && onEdit}
    <div class="pw-pop-backdrop" onclick={closePop} role="presentation"></div>
    <div class="pw-pop" class:up={pop.up} style="{pop.up ? `bottom:${pop.top}px` : `top:${pop.top}px`}; left:{pop.left}px;">
      {#if pop.kind === 'identity'}
        <h4>Gem type</h4>
        <div class="opts">
          <button type="button" class="opt" class:on={edit.gemType === 'order'} onclick={() => pick(() => (edit.gemType = 'order'), true)}>Order</button>
          <button type="button" class="opt" class:on={edit.gemType === 'chaos'} onclick={() => pick(() => (edit.gemType = 'chaos'), true)}>Chaos</button>
        </div>
        <h4>Gem</h4>
        <div class="opts col">
          {#each BASE_COSTS as bc (bc)}
            <button type="button" class="opt" class:on={edit.baseCost === bc} onclick={() => pick(() => (edit.baseCost = bc), true)}>
              {GEM_NAMES[bc][edit.gemType === 'chaos' ? 'chaos' : 'order']} ({bc}-cost)
            </button>
          {/each}
        </div>
        <h4>Rarity</h4>
        <div class="opts">
          {#each RARITIES as r (r)}
            <button type="button" class="opt" class:on={edit.rarity === r} onclick={() => pick(() => (edit.rarity = r), true)}>
              {r[0].toUpperCase() + r.slice(1)} - {RARITY_TURNS[r]} turns
            </button>
          {/each}
        </div>
      {:else if pop.kind === 'level'}
        <h4>Level</h4>
        <div class="opts">
          {#each LEVELS as lv (lv)}
            {@const field = pop.field}
            <button type="button" class="opt" class:on={edit[field] === lv} onclick={() => pick(() => (edit[field] = lv))}>{lv}</button>
          {/each}
        </div>
      {:else if pop.kind === 'effect'}
        {@const which = pop.which}
        <h4>{which === 'effect1' ? 'Effect 1 (left)' : 'Effect 2 (right)'}</h4>
        <div class="opts col">
          {#each EFFECT_POOLS[edit.baseCost] ?? [] as e (e)}
            <button type="button" class="opt" class:on={edit[which] === e} disabled={effectDisabled(which, e)} onclick={() => pick(() => (edit[which] = e), true)}>
              {abbr(e)}{effectDisabled(which, e) ? ' (other slot)' : ''}
            </button>
          {/each}
        </div>
        <h4>Level</h4>
        <div class="opts">
          {#each LEVELS as lv (lv)}
            {@const lf = (which + 'Level') as 'effect1Level' | 'effect2Level'}
            <button type="button" class="opt" class:on={edit[lf] === lv} onclick={() => pick(() => (edit[lf] = lv), true)}>{lv}</button>
          {/each}
        </div>
      {:else if pop.kind === 'turn'}
        <h4>Attempts remaining (Process x/{maxTurns})</h4>
        <div class="opts">
          {#each Array.from({ length: maxTurns }, (_, k) => maxTurns - k) as x (x)}
            <button type="button" class="opt" class:on={attemptsShown === x} onclick={() => pick(() => (edit.currentTurn = maxTurns - x + 1))}>{x}/{maxTurns}</button>
          {/each}
        </div>
      {:else if pop.kind === 'rerolls'}
        <h4>Free rerolls left</h4>
        <div class="opts">
          {#each Array.from({ length: RARITY_REROLLS[edit.rarity] ?? 3 }, (_, k) => k) as fr (fr)}
            <button type="button" class="opt" class:on={edit.rerollFree === fr} onclick={() => pick(() => (edit.rerollFree = fr))}>{fr}</button>
          {/each}
        </div>
      {:else if pop.kind === 'cost'}
        <h4>Processing cost</h4>
        <div class="opts">
          <button type="button" class="opt" class:on={edit.costMult === 0} onclick={() => pick(() => (edit.costMult = 0))}>900</button>
          <button type="button" class="opt" class:on={edit.costMult === 100} onclick={() => pick(() => (edit.costMult = 100))}>1,800 (+100%)</button>
          <button type="button" class="opt" class:on={edit.costMult === -100} onclick={() => pick(() => (edit.costMult = -100))}>0 (−100%)</button>
        </div>
      {:else if pop.kind === 'reset'}
        <h4>Reset counter</h4>
        <div class="opts">
          <button type="button" class="opt" class:on={edit.resetAvail === 1} onclick={() => pick(() => (edit.resetAvail = 1))}>Available (1/1)</button>
          <button type="button" class="opt" class:on={edit.resetAvail === 0} onclick={() => pick(() => (edit.resetAvail = 0))}>Used (0/1)</button>
        </div>
      {:else if pop.kind === 'outcome'}
        {@const i = pop.i}
        <h4>Outcome {i + 1}</h4>
        {#each OUT_TARGETS as t (t)}
          <div class="grp">
            <div class="gl"><span class="sw" style="background:{SLOT[slotOf(t)]?.color ?? SLOT.neutral.color};"></span>{targetLabel(t)}</div>
            <div class="opts">
              {#each [1, 2, 3, 4] as n (n)}
                <button type="button" class="opt" disabled={levelOf(t) + n > 5} onclick={() => setOutcome(i, { type: 'raise_effect', target: t, amount: n })}>+{n}</button>
              {/each}
              <button type="button" class="opt" disabled={levelOf(t) <= 1} onclick={() => setOutcome(i, { type: 'lower_effect', target: t, amount: 1 })}>−1</button>
              {#if t === 'effect1' || t === 'effect2'}
                <button type="button" class="opt" onclick={() => setOutcome(i, { type: 'change_side_option', target: t })}>Change</button>
              {/if}
            </div>
          </div>
        {/each}
        <div class="grp">
          <div class="gl">Cost</div>
          <div class="opts">
            <button type="button" class="opt" onclick={() => setOutcome(i, { type: 'change_gold_cost', change: 100 })}>+100%</button>
            <button type="button" class="opt" onclick={() => setOutcome(i, { type: 'change_gold_cost', change: -100 })}>−100%</button>
          </div>
        </div>
        <div class="grp">
          <div class="gl">View Other Items</div>
          <div class="opts">
            <button type="button" class="opt" onclick={() => setOutcome(i, { type: 'reroll_increase', change: 1 })}>+1</button>
            <button type="button" class="opt" onclick={() => setOutcome(i, { type: 'reroll_increase', change: 2 })}>+2</button>
            <button type="button" class="opt" onclick={() => setOutcome(i, { type: 'do_nothing' })}>Nothing</button>
          </div>
        </div>
      {/if}
    </div>
  {/if}

  <!-- comprehensive dropdown backup (the whole state in one form) -->
  {#if onEdit}
    <div class="pw-editor">
      <button type="button" class="pw-edit-toggle" aria-expanded={editing} onclick={() => (editing = !editing)}>
        {editing ? '▾ Hide the full editor' : '▸ Or set everything from dropdowns'}
      </button>

      {#if editing}
        <div class="pw-edit-body">
          <div class="pw-edit-grid">
            <label>Type
              <select bind:value={edit.gemType} onchange={commit}>
                <option value="order">Order</option>
                <option value="chaos">Chaos</option>
              </select>
            </label>
            <label>Base cost
              <select bind:value={edit.baseCost} onchange={commit}>
                {#each BASE_COSTS as bc (bc)}<option value={bc}>{bc}</option>{/each}
              </select>
            </label>
            <label>Rarity
              <select bind:value={edit.rarity} onchange={commit}>
                {#each RARITIES as r (r)}<option value={r}>{r[0].toUpperCase() + r.slice(1)}</option>{/each}
              </select>
            </label>

            <label>Willpower
              <select bind:value={edit.willpowerLevel} onchange={commit}>
                {#each LEVELS as lv (lv)}<option value={lv}>{lv}</option>{/each}
              </select>
            </label>
            <label>{edit.gemType === 'chaos' ? 'Chaos' : 'Order'} Points
              <select bind:value={edit.orderLevel} onchange={commit}>
                {#each LEVELS as lv (lv)}<option value={lv}>{lv}</option>{/each}
              </select>
            </label>
            <span class="pw-edit-spacer"></span>

            <label class="wide">Effect 1
              <span class="pw-edit-pair">
                <select bind:value={edit.effect1} onchange={commit}>
                  {#each EFFECT_POOLS[edit.baseCost] ?? [] as e (e)}<option value={e}>{abbr(e)}</option>{/each}
                </select>
                <select class="lv" bind:value={edit.effect1Level} onchange={commit}>
                  {#each LEVELS as lv (lv)}<option value={lv}>Lv. {lv}</option>{/each}
                </select>
              </span>
            </label>
            <label class="wide">Effect 2
              <span class="pw-edit-pair">
                <select bind:value={edit.effect2} onchange={commit}>
                  {#each EFFECT_POOLS[edit.baseCost] ?? [] as e (e)}<option value={e}>{abbr(e)}</option>{/each}
                </select>
                <select class="lv" bind:value={edit.effect2Level} onchange={commit}>
                  {#each LEVELS as lv (lv)}<option value={lv}>Lv. {lv}</option>{/each}
                </select>
              </span>
            </label>

            <label>Turn
              <select bind:value={edit.currentTurn} onchange={commit}>
                {#each Array.from({ length: RARITY_TURNS[edit.rarity] ?? 9 }, (_, k) => k + 1) as t (t)}
                  <option value={t}>{t} / {RARITY_TURNS[edit.rarity] ?? 9}</option>
                {/each}
              </select>
            </label>
            <label>Free rerolls
              <select bind:value={edit.rerollFree} onchange={commit}>
                {#each Array.from({ length: RARITY_REROLLS[edit.rarity] ?? 3 }, (_, k) => k) as fr (fr)}
                  <option value={fr}>{fr}</option>
                {/each}
              </select>
            </label>
            <label>Reset
              <select bind:value={edit.resetAvail} onchange={commit}>
                <option value={1}>Available</option>
                <option value={0}>Used</option>
              </select>
            </label>

            <label>Processing cost
              <select bind:value={edit.costMult} onchange={commit}>
                <option value={0}>Base (900)</option>
                <option value={100}>+100%</option>
                <option value={-100}>-100%</option>
              </select>
            </label>
          </div>

          <div class="pw-edit-outcomes">
            <div class="pw-edit-oc-title">Possible outcomes (one is applied at random)</div>
            {#each edit.outcomes as o, i (i)}
              <div class="pw-edit-oc">
                <span class="oc-idx">{i + 1}</span>
                <select bind:value={o.type} onchange={commit}>
                  {#each OUTCOME_KINDS as k (k.type)}<option value={k.type}>{k.label}</option>{/each}
                </select>
                {#if o.type === 'raise_effect' || o.type === 'lower_effect'}
                  <select bind:value={o.target} onchange={commit}>
                    {#each OUT_TARGETS as t (t)}<option value={t}>{targetLabel(t)}</option>{/each}
                  </select>
                  <select class="lv" bind:value={o.amount} onchange={commit}>
                    {#each [1, 2, 3, 4] as a (a)}<option value={a}>{o.type === 'raise_effect' ? '+' : '-'}{a}</option>{/each}
                  </select>
                {:else if o.type === 'change_side_option'}
                  <select bind:value={o.target} onchange={commit}>
                    {#each ['effect1', 'effect2'] as t (t)}<option value={t}>{targetLabel(t)}</option>{/each}
                  </select>
                {:else if o.type === 'change_gold_cost'}
                  <select class="lv" bind:value={o.change} onchange={commit}>
                    <option value={100}>+100%</option>
                    <option value={-100}>-100%</option>
                  </select>
                {:else if o.type === 'reroll_increase'}
                  <select class="lv" bind:value={o.change} onchange={commit}>
                    <option value={1}>+1</option>
                    <option value={2}>+2</option>
                  </select>
                {/if}
              </div>
            {/each}
          </div>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .pw-card {
    --gold: #c9a24a;
    position: relative;
    width: 100%;
    max-width: 760px; /* the design's native width; the wrapper decides how much of it to use */
    border-radius: 0.7rem;
    overflow: hidden;
    border: 1px solid #2a3350;
    background: #05070e;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
    font-family: 'EB Garamond', Georgia, 'Times New Roman', serif;
  }
  /* "Start a fresh cut", top-right of the visualizer, over the nebula, clear of the centered title. */
  .pw-fresh {
    position: absolute;
    top: 10px;
    right: 10px;
    z-index: 30;
    width: 30px;
    height: 30px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 16px;
    line-height: 1;
    color: #e7d9b0;
    background: linear-gradient(180deg, #3b4454, #232a37);
    border: 1px solid #6a5a2e;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.5);
    cursor: pointer;
    transition: filter 0.12s ease, color 0.12s ease, border-color 0.12s ease;
  }
  .pw-fresh:hover {
    filter: brightness(1.15);
    color: #ffe08a;
    border-color: #c9a24a;
  }
  .pw-fresh:focus-visible {
    outline: 2px solid #ffe08a;
    outline-offset: 2px;
  }

  .pw-stage {
    position: relative;
    width: 100%;
    overflow: hidden;
    background: radial-gradient(120% 90% at 50% 8%, #12213a 0%, #0a1120 38%, #05070e 78%, #03040a 100%);
  }
  .pw-nebula {
    position: absolute;
    inset: 0;
    pointer-events: none;
    background:
      radial-gradient(40% 30% at 22% 40%, rgba(40, 120, 180, 0.2), transparent 70%),
      radial-gradient(45% 35% at 80% 55%, rgba(80, 60, 160, 0.16), transparent 70%),
      radial-gradient(30% 24% at 60% 20%, rgba(90, 150, 190, 0.14), transparent 70%);
  }
  .pw-panel {
    position: absolute;
    top: 0;
    left: 50%;
    width: 760px;
    transform-origin: top center;
  }
  .pw-vignette {
    position: absolute;
    inset: 0;
    pointer-events: none;
    box-shadow: inset 0 0 120px 30px rgba(0, 0, 0, 0.85), inset 0 0 40px 4px rgba(0, 0, 0, 0.6);
    z-index: 40;
  }
  .pw-inner {
    position: relative;
    padding: 26px 46px 40px;
    z-index: 10;
    color: #e7e3d6;
  }

  /* editable affordance shared by every in-window control */
  .pw-edit {
    background: none;
    border: 0;
    padding: 0;
    color: inherit;
    font: inherit;
    cursor: pointer;
    border-radius: 6px;
    transition: filter 0.12s ease, background 0.12s ease;
  }
  .pw-edit:hover {
    filter: brightness(1.12);
  }
  .pw-edit:focus-visible {
    outline: 2px solid #ffe08a;
    outline-offset: 2px;
  }

  .pw-titlerow {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 16px;
    margin-bottom: 20px;
  }
  .pw-rule {
    height: 1px;
    width: 120px;
  }
  .pw-rule.left {
    background: linear-gradient(90deg, transparent, rgba(180, 160, 110, 0.55));
  }
  .pw-rule.right {
    background: linear-gradient(90deg, rgba(180, 160, 110, 0.55), transparent);
  }
  .pw-title {
    font-family: 'Cinzel', serif;
    font-weight: 600;
    font-size: 30px;
    letter-spacing: 2px;
    color: #f3ecdb;
    text-shadow: 0 2px 10px rgba(120, 170, 220, 0.5), 0 0 2px rgba(0, 0, 0, 0.9);
  }

  .pw-iconrow {
    display: flex;
    justify-content: center;
    margin-bottom: 14px;
  }
  .pw-icon {
    position: relative;
    width: 82px;
    height: 82px;
    border-radius: 10px;
    border: 2px solid #6d7690;
    background: linear-gradient(160deg, #232c40, #10131f);
    cursor: pointer;
    padding: 0;
  }
  .pw-icon:hover {
    filter: brightness(1.1);
  }
  .pw-icon:focus-visible {
    outline: 2px solid #ffe08a;
    outline-offset: 2px;
  }
  .pw-icon-img {
    position: absolute;
    inset: 6px;
    width: calc(100% - 12px);
    height: calc(100% - 12px);
    object-fit: contain;
    border-radius: 6px;
  }
  .pw-icon-cog {
    position: absolute;
    right: -8px;
    bottom: -8px;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    background: radial-gradient(circle at 40% 35%, #c9a7e6, #6a3fa0 70%, #2c1450);
    border: 1px solid rgba(230, 210, 255, 0.55);
    box-shadow: 0 0 8px rgba(150, 90, 220, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    color: #f0e2ff;
    font-size: 14px;
  }

  .pw-name {
    display: block;
    width: 100%;
    text-align: center;
    font-family: 'Cinzel', serif;
    font-weight: 600;
    font-size: 24px;
    letter-spacing: 0.5px;
    margin-bottom: 2px;
  }
  .pw-divider {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    margin: 6px auto 14px;
    width: 340px;
  }
  .d-rule {
    height: 1px;
    flex: 1;
  }
  .pw-divider .d-rule:first-child {
    background: linear-gradient(90deg, transparent, rgba(190, 150, 90, 0.7));
  }
  .pw-divider .d-rule:last-child {
    background: linear-gradient(90deg, rgba(190, 150, 90, 0.7), transparent);
  }
  .d-dot {
    width: 7px;
    height: 7px;
    transform: rotate(45deg);
    background: rgba(210, 175, 110, 0.9);
    box-shadow: 0 0 6px rgba(210, 175, 110, 0.7);
  }

  .pw-points {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 9px;
    margin-bottom: 14px;
    font-size: 20px;
    color: #e9e2d0;
  }
  .pw-help {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    border: 1.5px solid #4f8f52;
    color: #7bd47e;
    font-size: 14px;
    font-weight: 700;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: rgba(30, 60, 35, 0.4);
    cursor: help;
  }

  .pw-resetrow {
    display: flex;
    justify-content: center;
    margin-bottom: 12px;
  }
  .pw-reset {
    min-width: 190px;
    text-align: center;
    padding: 9px 26px;
    border-radius: 4px;
    font-size: 19px;
    color: #d7dbe4;
    background: linear-gradient(180deg, #3b4454, #232a37);
    border: 1px solid #545d6e;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.08);
  }
  .pw-reset.used {
    opacity: 0.55;
  }

  .pw-wheel {
    position: relative;
    width: 100%;
    height: 400px;
    margin-bottom: 6px;
  }
  .ring {
    position: absolute;
    left: 50%;
    top: 200px;
    transform: translate(-50%, -50%);
    border-radius: 50%;
    pointer-events: none;
  }
  .ring-fade {
    width: 392px;
    height: 392px;
    background: radial-gradient(circle, rgba(8, 14, 22, 0) 30%, rgba(6, 10, 18, 0.55) 62%, rgba(3, 5, 10, 0.15) 74%, transparent 80%);
  }
  .ring-border {
    width: 372px;
    height: 372px;
    border: 1px solid rgba(150, 130, 80, 0.28);
    box-shadow: inset 0 0 40px rgba(0, 0, 0, 0.6);
  }
  .ring-tick-outer {
    width: 392px;
    height: 392px;
    animation: la-spin 140s linear infinite;
    background: repeating-conic-gradient(from 0deg, rgba(190, 165, 105, 0) 0deg, rgba(190, 165, 105, 0) 2.4deg, rgba(200, 175, 115, 0.42) 2.4deg, rgba(200, 175, 115, 0.42) 3deg);
    -webkit-mask: radial-gradient(circle, transparent 0 173px, #000 174px 186px, transparent 187px);
    mask: radial-gradient(circle, transparent 0 173px, #000 174px 186px, transparent 187px);
  }
  .ring-tick-inner {
    width: 300px;
    height: 300px;
    animation: la-spin-rev 200s linear infinite;
    background: repeating-conic-gradient(from 0deg, transparent 0deg, transparent 5.2deg, rgba(170, 150, 100, 0.3) 5.2deg, rgba(170, 150, 100, 0.3) 6deg);
    -webkit-mask: radial-gradient(circle, transparent 0 132px, #000 133px 143px, transparent 144px);
    mask: radial-gradient(circle, transparent 0 132px, #000 133px 143px, transparent 144px);
  }
  .ring-hair {
    width: 250px;
    height: 250px;
    border: 1px solid rgba(140, 120, 75, 0.3);
  }
  .ring-core {
    width: 230px;
    height: 230px;
    background: radial-gradient(circle, rgba(2, 4, 8, 0.75), rgba(4, 7, 13, 0.35) 70%, transparent);
  }
  @keyframes la-spin {
    to {
      transform: translate(-50%, -50%) rotate(360deg);
    }
  }
  @keyframes la-spin-rev {
    to {
      transform: translate(-50%, -50%) rotate(-360deg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .ring-tick-outer,
    .ring-tick-inner {
      animation: none;
    }
  }

  .pw-gem {
    position: absolute;
    width: 158px;
    height: 158px;
    display: block;
  }
  .gem-spike {
    position: absolute;
    z-index: 5;
    width: 24px;
    height: 15px;
    clip-path: polygon(50% 0, 100% 100%, 0 100%);
    background: linear-gradient(180deg, #b6a066, #4a4230);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
  }
  .gem-spike.tr {
    top: 30px;
    right: 30px;
    transform: translate(50%, -50%) rotate(45deg);
  }
  .gem-spike.br {
    bottom: 30px;
    right: 30px;
    transform: translate(50%, 50%) rotate(135deg);
  }
  .gem-spike.bl {
    bottom: 30px;
    left: 30px;
    transform: translate(-50%, 50%) rotate(225deg);
  }
  .gem-spike.tl {
    top: 30px;
    left: 30px;
    transform: translate(-50%, -50%) rotate(315deg);
  }
  .gem-frame {
    position: absolute;
    inset: 12px;
    transform: rotate(45deg);
    border-radius: 5px;
    background: linear-gradient(135deg, #6a6048 0%, #39393f 42%, #1a1b20 78%, #0c0d11 100%);
    border: 2px solid rgba(160, 138, 86, 0.6);
    box-shadow: 0 7px 18px rgba(0, 0, 0, 0.65), inset 0 2px 3px rgba(255, 255, 255, 0.18), inset 0 -4px 8px rgba(0, 0, 0, 0.7);
  }
  .gem-groove {
    position: absolute;
    inset: 22px;
    transform: rotate(45deg);
    border-radius: 4px;
    background: #0b0c10;
    box-shadow: inset 0 0 8px rgba(0, 0, 0, 0.85);
  }
  .gem-body {
    position: absolute;
    inset: 27px;
    transform: rotate(45deg);
    border-radius: 3px;
    border: 1px solid rgba(255, 255, 255, 0.28);
  }
  .gem-label {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    pointer-events: none;
    z-index: 6;
  }
  .gem-name {
    font-family: 'Cinzel', serif;
    font-weight: 600;
    font-size: 16px;
    line-height: 1.05;
    color: #fff;
    text-shadow: 0 1px 3px rgba(0, 0, 0, 0.9), 0 0 4px rgba(0, 0, 0, 0.8);
    padding: 0 10px;
  }
  .gem-val {
    font-family: 'Cinzel', serif;
    font-weight: 700;
    font-size: 17px;
    color: #ffe08a;
    text-shadow: 0 1px 3px rgba(0, 0, 0, 0.95);
    margin-top: 2px;
  }
  .gem-val.big {
    font-size: 22px;
  }
  .pw-gem.flag .gem-frame {
    border-color: #f0b429;
    box-shadow: 0 0 0 2px rgba(240, 180, 41, 0.85), 0 7px 18px rgba(0, 0, 0, 0.65), inset 0 2px 3px rgba(255, 255, 255, 0.18);
    animation: pw-pulse 1.4s ease-in-out infinite;
  }

  .pw-hint {
    text-align: center;
    font-size: 19px;
    color: #dfd8c8;
    margin: 2px 0 14px;
  }

  .pw-outcomerow {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 18px;
  }
  .pw-outcomes {
    flex: 1;
    display: flex;
    justify-content: space-around;
    align-items: flex-start;
  }
  .pw-oc {
    width: 118px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 4px 0;
  }
  .pw-oc.flag {
    outline: 2px solid #f0b429;
    outline-offset: 2px;
    animation: pw-pulse 1.4s ease-in-out infinite;
  }
  .oc-diamond {
    position: relative;
    width: 40px;
    height: 40px;
    display: block;
  }
  .oc-spike {
    position: absolute;
    z-index: 5;
    width: 11px;
    height: 6px;
    clip-path: polygon(50% 0, 100% 100%, 0 100%);
    background: linear-gradient(180deg, #b6a066, #4a4230);
  }
  .oc-spike.tr {
    top: 5px;
    right: 5px;
    transform: translate(50%, -50%) rotate(45deg);
  }
  .oc-spike.br {
    bottom: 5px;
    right: 5px;
    transform: translate(50%, 50%) rotate(135deg);
  }
  .oc-spike.bl {
    bottom: 5px;
    left: 5px;
    transform: translate(-50%, 50%) rotate(225deg);
  }
  .oc-spike.tl {
    top: 5px;
    left: 5px;
    transform: translate(-50%, -50%) rotate(315deg);
  }
  .oc-body {
    position: absolute;
    inset: 3px;
    transform: rotate(45deg);
    border-radius: 2px;
    border: 1px solid rgba(255, 255, 255, 0.24);
  }
  .oc-text {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
  }
  .oc-label {
    font-family: 'Cinzel', serif;
    font-weight: 600;
    font-size: 13.5px;
    line-height: 1.08;
    color: #eae3d2;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.9);
    padding: 0 2px;
  }
  .oc-val {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-top: 1px;
  }
  .oc-num {
    font-family: 'Cinzel', serif;
    font-weight: 700;
    font-size: 14px;
    color: #f3ecdb;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.95);
  }
  .oc-arrow {
    font-size: 11px;
  }
  .pw-reroll {
    width: 104px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 5px;
  }
  .reroll-btn {
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1px;
    text-align: center;
    padding: 9px 0;
    border-radius: 4px;
    color: #3a2c08;
    background: linear-gradient(180deg, #e6c266, #c79a34 55%, #a97c22);
    border: 1px solid #f0da95;
    box-shadow: 0 3px 8px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.5);
    cursor: pointer;
    transition: filter 0.12s ease;
  }
  .reroll-btn:hover {
    filter: brightness(1.06);
  }
  .reroll-btn:focus-visible {
    outline: 2px solid #ffe08a;
    outline-offset: 2px;
  }
  .reroll-word {
    font-family: 'Cinzel', serif;
    font-weight: 600;
    font-size: 18px;
    line-height: 1.15;
  }
  .reroll-num {
    font-family: 'Cinzel', serif;
    font-weight: 700;
    font-size: 18px;
    line-height: 1.15;
    color: #5a4410;
  }

  .pw-hairline {
    height: 1px;
    background: linear-gradient(90deg, transparent, rgba(150, 130, 85, 0.5) 20%, rgba(150, 130, 85, 0.5) 80%, transparent);
    margin-bottom: 12px;
  }
  .pw-costrow {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 20px;
    color: #8fb0d8;
    margin-bottom: 14px;
  }
  .pw-cost-val {
    display: flex;
    align-items: center;
    gap: 8px;
    color: #f0ead9;
  }
  .pw-coin {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: radial-gradient(circle at 38% 32%, #ffe9a3, #e0a838 55%, #9a6c16);
    border: 1px solid #ffe9a3;
    box-shadow: 0 0 5px rgba(230, 180, 70, 0.7);
  }
  .pw-buttons {
    display: flex;
    gap: 14px;
  }
  .pw-btn {
    flex: 1;
    text-align: center;
    padding: 15px 0;
    border-radius: 4px;
    font-family: 'Cinzel', serif;
    font-weight: 500;
    font-size: 20px;
  }
  .pw-btn.complete {
    color: #7f8794;
    background: linear-gradient(180deg, #2a303c, #1b2028);
    border: 1px solid #3d4450;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05);
  }
  .pw-btn.process {
    color: #e5e9f0;
    background: linear-gradient(180deg, #41495a, #2a313d);
    border: 1px solid #59637a;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.1);
  }

  @keyframes pw-pulse {
    50% {
      outline-color: rgba(240, 180, 41, 0.3);
    }
  }
  .pw-points.flag,
  .pw-name.flag,
  .pw-cost-val.flag {
    outline: 2px solid #f0b429;
    outline-offset: 3px;
    border-radius: 4px;
    animation: pw-pulse 1.4s ease-in-out infinite;
  }

  .pw-confstrip {
    padding: 0.4rem 0.6rem;
    background: rgba(240, 180, 41, 0.14);
    color: #f0b429;
    font-family: 'Inter', system-ui, sans-serif;
    font-size: 0.78rem;
    text-align: center;
  }

  /* ---- popover editors ---- */
  .pw-pop-backdrop {
    position: fixed;
    inset: 0;
    z-index: 998;
  }
  .pw-pop {
    position: fixed;
    z-index: 999;
    width: 240px;
    max-height: 62vh;
    overflow: auto;
    background: #171d2e;
    border: 1px solid #33405f;
    border-radius: 10px;
    box-shadow: 0 12px 30px rgba(0, 0, 0, 0.6);
    padding: 10px;
    font-family: 'Inter', system-ui, sans-serif;
  }
  .pw-pop h4 {
    margin: 0 0 6px;
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #8ea3c6;
    font-weight: 700;
  }
  .pw-pop h4:not(:first-child) {
    margin-top: 10px;
  }
  .pw-pop .opts {
    display: flex;
    gap: 5px;
    flex-wrap: wrap;
  }
  .pw-pop .opts.col {
    flex-direction: column;
    align-items: stretch;
  }
  .pw-pop .grp {
    margin-bottom: 7px;
  }
  .pw-pop .grp .gl {
    font-size: 0.72rem;
    color: #cdd6e6;
    margin-bottom: 3px;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .pw-pop .sw {
    width: 10px;
    height: 10px;
    border-radius: 3px;
    display: inline-block;
  }
  .pw-pop button.opt {
    background: #101626;
    border: 1px solid #2a3550;
    border-radius: 7px;
    color: #e6ecf7;
    cursor: pointer;
    padding: 6px 10px;
    font-size: 0.8rem;
    min-width: 36px;
    font-family: inherit;
  }
  .pw-pop button.opt:hover {
    border-color: #4ea3e6;
  }
  .pw-pop button.opt.on {
    border-color: #4ea3e6;
    background: rgba(78, 163, 230, 0.16);
  }
  .pw-pop button.opt:disabled {
    opacity: 0.3;
    cursor: default;
  }

  /* ---- dropdown backup ---- */
  .pw-editor {
    font-family: 'Inter', system-ui, sans-serif;
    background: #0c1120;
    border-top: 1px solid #222c46;
  }
  .pw-edit-toggle {
    width: 100%;
    text-align: left;
    padding: 0.55rem 0.8rem;
    background: none;
    border: none;
    color: #9db4d8;
    font: inherit;
    font-size: 0.82rem;
    cursor: pointer;
  }
  .pw-edit-toggle:hover {
    color: #cfe0f5;
  }
  .pw-edit-body {
    padding: 0.2rem 0.8rem 0.9rem;
  }
  .pw-edit-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.5rem 0.6rem;
  }
  .pw-edit-grid label,
  .pw-edit-oc {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    font-size: 0.72rem;
    color: #93a4c2;
  }
  .pw-edit-grid label.wide {
    grid-column: span 3;
  }
  .pw-edit-spacer {
    display: none;
  }
  .pw-edit-pair {
    display: flex;
    gap: 0.4rem;
  }
  .pw-edit-pair select:first-child {
    flex: 1;
  }
  .pw-editor select {
    background: #182035;
    color: #e6ecf7;
    border: 1px solid #33405f;
    border-radius: 0.3rem;
    padding: 0.28rem 0.35rem;
    font: inherit;
    font-size: 0.78rem;
  }
  .pw-editor select.lv {
    max-width: 6.5rem;
  }
  .pw-editor select:focus-visible {
    outline: 2px solid #4ea3e6;
    outline-offset: 1px;
  }
  .pw-edit-outcomes {
    margin-top: 0.8rem;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .pw-edit-oc-title {
    font-size: 0.72rem;
    color: #7c8aa8;
    margin-bottom: 0.1rem;
  }
  .pw-edit-oc {
    flex-direction: row;
    align-items: center;
    gap: 0.4rem;
  }
  .oc-idx {
    width: 1.1rem;
    height: 1.1rem;
    flex: none;
    border-radius: 50%;
    background: #223054;
    color: #9db4d8;
    font-size: 0.68rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .pw-edit-oc select {
    flex: 1;
    min-width: 0;
  }
</style>
