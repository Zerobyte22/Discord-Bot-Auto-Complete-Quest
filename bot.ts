import { ClientQuest } from './client';

const MODE = process.env.QUEST_MODE ?? process.env.MODE ?? '';
const TOKEN = process.env.TOKEN;
const QUEST_ID = process.env.QUEST_ID ?? '';

if (!TOKEN) {
	console.error('[bot.ts] TOKEN ausente');
	process.exit(1);
}

function emit(event: string, payload: Record<string, any> = {}) {
	console.log(`__EVT__${JSON.stringify({ event, ...payload })}__EVT__`);
}

function emitQuestData(quest: any) {
	const config = quest.config ?? {};
	const tasks = config.task_config_v2?.tasks ?? {};
	const taskKeys = Object.keys(tasks);
	const task = taskKeys[0] ?? 'UNKNOWN';
	const target = tasks[task]?.target ?? 0;
	const done = quest.userStatus?.progress?.[task]?.value ?? 0;
	const rewards = config.rewards_config?.rewards ?? [];
	const firstReward = rewards[0] ?? {};

	console.log(
		`__QUEST_DATA__${JSON.stringify({
			id: quest.id,
			name: config.messages?.quest_name ?? 'Quest',
			game: config.messages?.game_title ?? '',
			publisher: config.messages?.game_publisher ?? '',
			hero: config.assets?.hero ?? null,
			tile: config.assets?.game_tile ?? null,
			logo: config.assets?.logotype ?? null,
			primaryColor: config.colors?.primary ?? null,
			secondaryColor: config.colors?.secondary ?? null,
			current: done,
			total: target,
			task,
			orbs: firstReward.orb_quantity ?? 0,
			rewardName: firstReward.messages?.name ?? null,
			rewardAsset: firstReward.asset ?? null,
			startsAt: config.starts_at ?? null,
			expiresAt: config.expires_at ?? null,
			cosponsor: config.cosponsor_metadata?.name ?? null,
			enrolled: Boolean(quest.userStatus?.enrolled_at),
		})}__QUEST_DATA__`
	);
}

async function safeDestroy(client: ClientQuest) {
	try {
		await client.destroy();
	} catch (e: any) {
		console.log(`[bot.ts] destroy falhou (ignorado): ${e?.message ?? e}`);
	}
}

async function main() {
	const client = new ClientQuest(TOKEN!);

	// ✅ 1) Conecta ao gateway. Se falhar, aborta com log claro.
	try {
		await client.connect();
	} catch (e: any) {
		console.error(`[bot.ts] connect() falhou: ${e?.message ?? e}`);
		process.exit(2);
	}

	// ✅ 2) Busca dados do usuário. Tenta /users/@me, cai pro client.user.
	let data: any = null;

	try {
		data = await client.rest.get('/users/@me');
		console.log(`[bot.ts] /users/@me OK: ${data?.username} (${data?.id})`);
	} catch (e: any) {
		console.log(`[bot.ts] /users/@me falhou: ${e?.message ?? e}`);
		console.log(`[bot.ts] Tentando fallback via gateway...`);

		// ✅ FALLBACK: pega o user direto do WebSocketManager do ClientQuest
		// O ClientQuest herda de @discordjs/core Client, que expõe .user no ready
		// Mas como estamos fora do evento ready, vamos usar a API interna:
		try {
			const wsClient = (client as any).client ?? (client as any);
			if (wsClient?.user) {
				data = wsClient.user;
				console.log(`[bot.ts] fallback OK: ${data.username} (${data.id})`);
			}
		} catch (e2: any) {
			console.log(`[bot.ts] fallback também falhou: ${e2?.message ?? e2}`);
		}
	}

	// ✅ 3) Última tentativa: buscar via REST com User-Agent do Android
	if (!data?.id) {
		try {
			console.log(`[bot.ts] tentando /users/@me com header Android...`);
			data = await client.rest.get('/users/@me', {
				headers: { 'User-Agent': 'Discord-Android/316011;RNA' } as any,
			});
			console.log(`[bot.ts] Android OK: ${data?.username} (${data?.id})`);
		} catch (e: any) {
			console.log(`[bot.ts] Android também falhou: ${e?.message ?? e}`);
		}
	}

	if (!data?.id) {
		console.error('[bot.ts] ❌ Não consegui obter dados do usuário por NENHUM método');
		console.error('[bot.ts] Token provavelmente inválido ou conta bloqueada');
		await safeDestroy(client);
		process.exit(1);
	}

	// ========================================================
	// PROFILE
	// ========================================================
	if (MODE === 'profile') {
		const baseProfile = {
			id: data.id,
			username: data.username,
			global_name: data.global_name ?? null,
			avatar: data.avatar ?? null,
			quests: 0,
			orbs: 0,
			questsList: [],
		};

		console.log(`__PROFILE_JSON_START__${JSON.stringify(baseProfile)}__PROFILE_JSON_END__`);

		try {
			const timeoutPromise = new Promise((_, reject) =>
				setTimeout(() => reject(new Error('timeout')), 15 * 1000)
			);
			await Promise.race([client.fetchQuests(false), timeoutPromise]);
			const quests = client.questManager!.filterQuestsValidToDo();

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
			console.log(`[profile] OK: ${quests.length} quests, ${totalOrbs} orbs`);
		} catch (err: any) {
			console.log(`[profile] fetchQuests falhou: ${err?.message ?? err}`);
		}

		await safeDestroy(client);
		process.exit(0);
	}

	// ========================================================
	// QUEST_SINGLE
	// ========================================================
	if (MODE === 'quest_single' && QUEST_ID) {
		console.log(`[quest_single] Executando ${QUEST_ID}...`);
		emit('found', { count: 1 });

		try {
			await client.fetchQuests(false);
			const quest = client.questManager!.get(QUEST_ID);
			if (!quest) {
				console.log(`[quest_single] não encontrada`);
				emit('fail', { name: QUEST_ID, error: 'Quest não encontrada' });
				await safeDestroy(client);
				process.exit(0);
			}

			const name = quest.config.messages.quest_name;
			emit('start', { index: 1, total: 1, name, id: quest.id });
			emitQuestData(quest);

			const progressInterval = setInterval(() => {
				try {
					const task = Object.keys((quest.config as any).task_config_v2?.tasks ?? {})[0];
					if (!task) return;
					const target = (quest.config as any).task_config_v2.tasks[task].target;
					const done = quest.userStatus?.progress?.[task]?.value ?? 0;
					console.log(
						`__PROGRESS_UPDATE__${JSON.stringify({
							id: quest.id,
							current: done,
							total: target,
						})}__PROGRESS_UPDATE__`
					);
				} catch {}
			}, 5 * 1000);

			try {
				await client.questManager!.doingQuest(quest);
				clearInterval(progressInterval);
				console.log(`Completed: "${name}"`);
				emit('done', { name, id: quest.id });
			} catch (err: any) {
				clearInterval(progressInterval);
				console.log(`Failed: "${name}" — ${err?.message ?? err}`);
				emit('fail', { name, id: quest.id, error: String(err?.message ?? err) });
			}
		} catch (err: any) {
			console.log(`[quest_single] erro: ${err?.message ?? err}`);
			emit('fatal', { error: String(err?.message ?? err) });
		}

		await safeDestroy(client);
		process.exit(0);
	}

	// ========================================================
	// MODOS EM LOTE
	// ========================================================
	console.log(`[quest] modo ${MODE}`);
	try {
		await client.fetchQuests(false);
		const quests = client.questManager!.filterQuestsValidToDo();
		emit('found', { count: quests.length });

		if (quests.length === 0) {
			await safeDestroy(client);
			process.exit(0);
		}

		const runQuest = async (quest: any, idx: number, total: number) => {
			const name = quest.config.messages.quest_name;
			emit('start', { index: idx, total, name, id: quest.id });
			emitQuestData(quest);
			try {
				await client.questManager!.doingQuest(quest);
				emit('done', { name, id: quest.id });
			} catch (err: any) {
				emit('fail', { name, id: quest.id, error: String(err?.message ?? err) });
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
		emit('fatal', { error: String(err?.message ?? err) });
	}

	await safeDestroy(client);
	process.exit(0);
}

main().catch((e) => {
	console.error('[bot.ts] erro fatal:', e);
	process.exit(1);
});
