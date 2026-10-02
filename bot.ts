// ✅ MODE lido do env (o index.ts manda QUEST_MODE)
const MODE = process.env.QUEST_MODE ?? process.env.MODE ?? '';

if (MODE === 'profile') {
	console.log('[profile] Iniciando...');

	// ✅ 1. Imprime o perfil BASE imediatamente (não depende de fetchQuests)
	const baseProfile = {
		id: data.user.id,
		username: data.user.username,
		global_name: (data.user as any).global_name ?? null,
		avatar: (data.user as any).avatar ?? null,
		quests: 0,
		orbs: 0,
		questsList: [],
	};

	// ✅ FIX: TUDO NUMA LINHA SÓ (a regex do index.ts é por linha)
	console.log(`__PROFILE_JSON_START__${JSON.stringify(baseProfile)}__PROFILE_JSON_END__`);
	console.log('[profile] Perfil base enviado');

	// ✅ 2. Tenta buscar quests (timeout curto)
	try {
		const timeoutPromise = new Promise((_, reject) =>
			setTimeout(() => reject(new Error('timeout')), 15 * 1000)
		);
		await Promise.race([client.fetchQuests(false), timeoutPromise]);
		const quests = client.questManager!.filterQuestsValidToDo();

		// ✅ Monta a lista completa de quests
		let totalOrbs = 0;
		const questsList = quests.map((q) => {
			const cfg = q.config as any;
			const tasks = cfg.task_config_v2?.tasks ?? {};
			const taskKeys = Object.keys(tasks);
			const task = taskKeys[0] ?? 'UNKNOWN';
			const target = tasks[task]?.target ?? 0;
			const done = q.userStatus?.progress?.[task]?.value ?? 0;
			const rewards = cfg.rewards_config?.rewards ?? [];
			const orbs = rewards.reduce((a: number, r: any) => a + (r.orb_quantity ?? 0), 0);
			totalOrbs += orbs;

			return {
				id: q.id,
				name: cfg.messages?.quest_name ?? 'Quest',
				game: cfg.messages?.game_title ?? '',
				publisher: cfg.messages?.game_publisher ?? '',
				hero: cfg.assets?.hero ?? null,
				tile: cfg.assets?.game_tile ?? null,
				task,
				orbs,
				current: done,
				total: target,
				expiresAt: cfg.expires_at ?? null,
				cosponsor: cfg.cosponsor_metadata?.name ?? null,
				primaryColor: cfg.colors?.primary ?? null,
				rewardName: rewards[0]?.messages?.name ?? null,
				rewardAsset: rewards[0]?.asset ?? null,
				startsAt: cfg.starts_at ?? null,
			};
		});

		const fullProfile = {
			...baseProfile,
			quests: quests.length,
			orbs: totalOrbs,
			questsList,
		};
		console.log(`__PROFILE_JSON_START__${JSON.stringify(fullProfile)}__PROFILE_JSON_END__`);
		console.log(`[profile] Perfil completo: ${quests.length} quests`);
	} catch (err: any) {
		console.log(`[profile] fetchQuests falhou: ${err?.message ?? err}`);
	}

	await client.destroy();
	process.exit(0);
}

// ✅ MODO QUEST_SINGLE — executa UMA quest específica
if (MODE === 'quest_single') {
	const QUEST_ID = process.env.QUEST_ID ?? '';
	console.log(`[quest_single] Executando quest ${QUEST_ID}...`);

	console.log(`__EVT__${JSON.stringify({ event: 'found', count: 1 })}__EVT__`);

	try {
		await client.fetchQuests(false);
		const quest = client.questManager!.get(QUEST_ID);

		if (!quest) {
			console.log(`[quest_single] Quest ${QUEST_ID} não encontrada`);
			console.log(`__EVT__${JSON.stringify({ event: 'fail', name: QUEST_ID, error: 'não encontrada' })}__EVT__`);
			await client.destroy();
			process.exit(0);
		}

		const name = quest.config.messages.quest_name;
		console.log(`__EVT__${JSON.stringify({ event: 'start', index: 1, total: 1, name, id: quest.id })}__EVT__`);

		// Emite __QUEST_DATA__ pra embed
		const cfg = quest.config as any;
		const tasks = cfg.task_config_v2?.tasks ?? {};
		const task = Object.keys(tasks)[0] ?? 'UNKNOWN';
		const target = tasks[task]?.target ?? 0;
		const done = quest.userStatus?.progress?.[task]?.value ?? 0;
		const rewards = cfg.rewards_config?.rewards ?? [];

		console.log(`__QUEST_DATA__${JSON.stringify({
			id: quest.id,
			name,
			game: cfg.messages?.game_title ?? '',
			publisher: cfg.messages?.game_publisher ?? '',
			hero: cfg.assets?.hero ?? null,
			tile: cfg.assets?.game_tile ?? null,
			task,
			orbs: rewards.reduce((a: number, r: any) => a + (r.orb_quantity ?? 0), 0),
			current: done,
			total: target,
			startsAt: cfg.starts_at ?? null,
			expiresAt: cfg.expires_at ?? null,
			cosponsor: cfg.cosponsor_metadata?.name ?? null,
			primaryColor: cfg.colors?.primary ?? null,
		})}__QUEST_DATA__`);

		// Progress tracker
		const progressInterval = setInterval(() => {
			const d = quest.userStatus?.progress?.[task]?.value ?? 0;
			console.log(`__PROGRESS_UPDATE__${JSON.stringify({
				id: quest.id,
				current: d,
				total: target,
			})}__PROGRESS_UPDATE__`);
		}, 5 * 1000);

		try {
			await client.questManager!.doingQuest(quest);
			clearInterval(progressInterval);
			console.log(`Completed: "${name}"`);
			console.log(`__EVT__${JSON.stringify({ event: 'done', name, id: quest.id })}__EVT__`);
		} catch (err: any) {
			clearInterval(progressInterval);
			console.log(`Failed: "${name}" — ${err?.message ?? err}`);
			console.log(`__EVT__${JSON.stringify({ event: 'fail', name, id: quest.id, error: String(err?.message) })}__EVT__`);
		}
	} catch (err: any) {
		console.log(`[quest_single] Erro: ${err?.message ?? err}`);
		console.log(`__EVT__${JSON.stringify({ event: 'fatal', error: String(err?.message) })}__EVT__`);
	}

	await client.destroy();
	process.exit(0);
}

// ✅ Modos em lote (compatibilidade)
if (
	MODE === 'sequential_no_delay' ||
	MODE === 'sequential_delay' ||
	MODE === 'all_parallel' ||
	MODE === 'all_delay'
) {
	console.log(`[quest] Modo: ${MODE}`);
	try {
		await client.fetchQuests(false);
		const quests = client.questManager!.filterQuestsValidToDo();
		console.log(`Found ${quests.length} valid quests`);
		console.log(`__EVT__${JSON.stringify({ event: 'found', count: quests.length })}__EVT__`);

		if (quests.length === 0) {
			await client.destroy();
			process.exit(0);
		}

		const runQuest = async (quest: any, idx: number, total: number) => {
			const name = quest.config.messages.quest_name;
			console.log(`[${idx}/${total}] Starting: "${name}"`);
			console.log(`__EVT__${JSON.stringify({ event: 'start', index: idx, total, name, id: quest.id })}__EVT__`);

			try {
				await client.questManager!.doingQuest(quest);
				console.log(`Completed: "${name}"`);
				console.log(`__EVT__${JSON.stringify({ event: 'done', name, id: quest.id })}__EVT__`);
			} catch (err: any) {
				console.log(`Failed: "${name}" — ${err?.message ?? err}`);
				console.log(`__EVT__${JSON.stringify({ event: 'fail', name, id: quest.id, error: String(err?.message) })}__EVT__`);
			}
		};

		if (MODE === 'all_parallel') {
			await Promise.all(quests.map((q, i) => runQuest(q, i + 1, quests.length)));
		} else if (MODE === 'all_delay' || MODE === 'sequential_delay') {
			for (let i = 0; i < quests.length; i++) {
				await runQuest(quests[i], i + 1, quests.length);
				if (i < quests.length - 1) await new Promise((r) => setTimeout(r, 3 * 60 * 1000));
			}
		} else {
			for (let i = 0; i < quests.length; i++) {
				await runQuest(quests[i], i + 1, quests.length);
			}
		}
	} catch (err: any) {
		console.log(`[quest] Erro: ${err?.message ?? err}`);
	}

	await client.destroy();
	process.exit(0);
}
