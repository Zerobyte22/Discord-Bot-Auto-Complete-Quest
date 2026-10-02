// ============================================================
// IMPORTS
// ============================================================
import { ClientQuest } from './client';

// ============================================================
// ✅ FIX #1: MODE lido de process.env (QUEST_MODE é o que o index.ts envia)
// ============================================================
const MODE = process.env.QUEST_MODE ?? process.env.MODE ?? '';
const TOKEN = process.env.TOKEN;

if (!TOKEN) {
	console.error('[bot.ts] TOKEN ausente');
	process.exit(1);
}

// ============================================================
// ✅ ADD #12: logger estruturado em JSON — facilita parsing no index.ts
// (mesmo padrão de __QUEST_DATA__ / __PROGRESS_UPDATE__)
// ============================================================
function emit(event: string, payload: Record<string, any> = {}) {
	console.log(`__EVT__${JSON.stringify({ event, ...payload })}__EVT__`);
}

// ============================================================
// ✅ FIX #2 (parte 1): safeDestroy evita travar se o WS já caiu
// ============================================================
async function safeDestroy(client: ClientQuest) {
	try {
		await client.destroy();
	} catch (e: any) {
		console.log(`[bot.ts] destroy falhou (ignorado): ${e?.message ?? e}`);
	}
}

// ============================================================
// MAIN
// ============================================================
async function main() {
	const client = new ClientQuest(TOKEN!);

	// ✅ FIX #1 (parte 2): conecta ANTES de decidir o que fazer.
	// Sem isso, `data` (que vem do /users/@me) não existe ainda.
	await client.connect();

	// ✅ FIX #1 (parte 3): data agora é buscado via REST oficial (/users/@me)
	const data = (await client.rest.get('/users/@me')) as any;

	// ========================================================
	// MODO: PROFILE
	// ========================================================
	if (MODE === 'profile') {
		console.log('[profile] Iniciando...');

		const baseProfile = {
			id: data.id,
			username: data.username,
			global_name: data.global_name ?? null,
			avatar: data.avatar ?? null,
			quests: 0,
		};

		// ✅ FIX #3: imprime em UMA linha — a regex do index.ts é linha-a-linha
		console.log(`__PROFILE_JSON_START__${JSON.stringify(baseProfile)}__PROFILE_JSON_END__`);
		console.log('[profile] Perfil base enviado');

		try {
			const timeoutPromise = new Promise((_, reject) =>
				setTimeout(() => reject(new Error('timeout')), 15 * 1000)
			);
			await Promise.race([client.fetchQuests(false), timeoutPromise]);
			const quests = client.questManager!.filterQuestsValidToDo();

			const fullProfile = { ...baseProfile, quests: quests.length };
			console.log(`__PROFILE_JSON_START__${JSON.stringify(fullProfile)}__PROFILE_JSON_END__`);
			console.log(`[profile] Perfil completo: ${quests.length} quests`);
			emit('profile_done', { quests: quests.length });
		} catch (err: any) {
			console.log(`[profile] fetchQuests falhou: ${err?.message ?? err}`);
			emit('profile_partial', { quests: 0 });
		}

		await safeDestroy(client);
		process.exit(0);
	}

	// ========================================================
	// MODO: QUESTS (sequential_no_delay / sequential_delay / all_parallel / all_delay)
	// ========================================================
	console.log(`[quest] Iniciando modo "${MODE}"...`);

	// ✅ ADD #12: emite found + start + done + fail via __EVT__
	try {
		await client.fetchQuests(false);
		const quests = client.questManager!.filterQuestsValidToDo();

		console.log(`Found ${quests.length} valid quests`);
		emit('found', { count: quests.length });

		if (quests.length === 0) {
			console.log('[quest] Nenhuma quest válida.');
			await safeDestroy(client);
			process.exit(0);
		}

		// ✅ ADD #12: helpers pra emitir start/done/fail + dados da quest
		const runQuest = async (quest: any, idx: number, total: number) => {
			const name = quest.config.messages.quest_name;
			console.log(`[${idx}/${total}] Starting: "${name}"`);
			emit('start', { index: idx, total, name, id: quest.id });

			// ✅ Mantém os marcadores existentes que o index.ts já parseia
			const config = quest.config;
			const taskKeys = Object.keys(config.task_config_v2?.tasks ?? {});
			const task = taskKeys[0] ?? 'UNKNOWN';
			const target =
				config.task_config_v2?.tasks?.[task]?.target ??
				config.task_config_v2?.tasks?.[task]?.target ?? 0;
			const done = quest.userStatus?.progress?.[task]?.value ?? 0;

			const questData = {
				id: quest.id,
				name,
				game: config.messages.game_title,
				publisher: config.messages.game_publisher,
				hero: config.assets?.hero ?? null,
				tile: config.assets?.game_tile ?? null,
				logo: config.assets?.logotype ?? null,
				primaryColor: config.colors?.primary ?? null,
				secondaryColor: config.colors?.secondary ?? null,
				current: done,
				total: target,
				task,
				orbs: config.rewards_config?.rewards?.[0]?.orb_quantity ?? 0,
				rewardName: config.rewards_config?.rewards?.[0]?.messages?.name ?? null,
				rewardAsset: config.rewards_config?.rewards?.[0]?.asset ?? null,
				startsAt: config.starts_at ?? null,
				expiresAt: config.expires_at ?? null,
				cosponsor: config.cosponsor_metadata?.name ?? null,
			};
			console.log(`__QUEST_DATA__${JSON.stringify(questData)}__QUEST_DATA__`);

			try {
				await client.questManager!.doingQuest(quest);
				console.log(`Completed: "${name}"`);
				emit('done', { name, id: quest.id });
			} catch (err: any) {
				console.log(`Failed: "${name}" — ${err?.message ?? err}`);
				emit('fail', { name, id: quest.id, error: String(err?.message ?? err) });
			}
		};

		// Modos de execução
		if (MODE === 'all_parallel') {
			await Promise.all(quests.map((q, i) => runQuest(q, i + 1, quests.length)));
		} else if (MODE === 'all_delay') {
			for (let i = 0; i < quests.length; i++) {
				await runQuest(quests[i], i + 1, quests.length);
				if (i < quests.length - 1) await new Promise((r) => setTimeout(r, 3 * 60 * 1000));
			}
		} else if (MODE === 'sequential_delay') {
			for (let i = 0; i < quests.length; i++) {
				await runQuest(quests[i], i + 1, quests.length);
				if (i < quests.length - 1) await new Promise((r) => setTimeout(r, 3 * 60 * 1000));
			}
		} else {
			// sequential_no_delay (default)
			for (let i = 0; i < quests.length; i++) {
				await runQuest(quests[i], i + 1, quests.length);
			}
		}
	} catch (err: any) {
		console.log(`[quest] Erro geral: ${err?.message ?? err}`);
		emit('fatal', { error: String(err?.message ?? err) });
	}

	await safeDestroy(client);
	process.exit(0);
}

main().catch((e) => {
	console.error('[bot.ts] erro fatal:', e);
	process.exit(1);
});a
