// ============================================================
// IMPORTS — usa ClientQuest do seu client.ts (API real)
// ============================================================
import { ClientQuest } from './client';

// ✅ FIX: lê o modo do env (QUEST_MODE é o que o index.ts manda)
const MODE = process.env.QUEST_MODE ?? process.env.MODE ?? '';
const TOKEN = process.env.TOKEN!;

if (!TOKEN) {
	console.error('[bot.ts] TOKEN ausente');
	process.exit(1);
}

// ✅ FIX: destrói com try/catch
async function safeDestroy(client: ClientQuest) {
	try {
		await client.destroy();
	} catch (e: any) {
		console.log(`[bot.ts] destroy falhou (ignorado): ${e?.message ?? e}`);
	}
}

async function main() {
	const client = new ClientQuest(TOKEN);

	// ✅ Conecta ANTES de tudo
	await client.connect();

	// ✅ FIX CRÍTICO: no ClientQuest original, o usuário vem do próprio ready.
	// A forma mais segura e que o selfbot original usava é /users/@me MESMO
	// — mas com fallback pro client.user do gateway.
	let data: any = null;
	try {
		data = await client.rest.get('/users/@me');
	} catch (e: any) {
		console.log(`[bot.ts] /users/@me falhou: ${e?.message ?? e}`);
		// Fallback: pega do próprio websocket (o ClientQuest expõe via ready)
		const wsClient = (client as any).client ?? (client as any).ws?.client;
		if (wsClient?.user) {
			data = wsClient.user;
		}
	}

	if (!data || !data.id) {
		console.error('[bot.ts] Não consegui obter dados do usuário — token provavelmente inválido');
		await safeDestroy(client);
		process.exit(1);
	}

	// ========================================================
	// MODO PROFILE — retorna id, username, avatar e quests
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

		// ✅ Uma linha só (regex do index.ts é por linha)
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
		} catch (err: any) {
			console.log(`[profile] fetchQuests falhou: ${err?.message ?? err}`);
		}

		await safeDestroy(client);
		process.exit(0);
	}

	// ========================================================
	// MODOS DE QUEST — usa doingQuest do seu questManager.ts
	// ========================================================
	console.log(`[quest] Iniciando modo "${MODE}"...`);

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

		const runQuest = async (quest: any, idx: number, total: number) => {
			const name = quest.config.messages.quest_name;
			console.log(`[${idx}/${total}] Starting: "${name}"`);
			emit('start', { index: idx, total, name, id: quest.id });

			// Envia __QUEST_DATA__ (o index.ts usa isso pra montar o embed ao vivo)
			try {
				const config = quest.config;
				const task = Object.keys(config.task_config_v2?.tasks ?? {})[0] ?? 'UNKNOWN';
				const target = config.task_config_v2?.tasks?.[task]?.target ?? 0;
				const done = quest.userStatus?.progress?.[task]?.value ?? 0;
				console.log(`__QUEST_DATA__${JSON.stringify({
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
				})}__QUEST_DATA__`);
			} catch {}

			try {
				await client.questManager!.doingQuest(quest);
				console.log(`Completed: "${name}"`);
				emit('done', { name, id: quest.id });
			} catch (err: any) {
				console.log(`Failed: "${name}" — ${err?.message ?? err}`);
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
		console.log(`[quest] Erro geral: ${err?.message ?? err}`);
		emit('fatal', { error: String(err?.message ?? err) });
	}

	await safeDestroy(client);
	process.exit(0);
}

// ✅ Logger estruturado
function emit(event: string, payload: Record<string, any> = {}) {
	console.log(`__EVT__${JSON.stringify({ event, ...payload })}__EVT__`);
}

main().catch((e) => {
	console.error('[bot.ts] erro fatal:', e);
	process.exit(1);
});
