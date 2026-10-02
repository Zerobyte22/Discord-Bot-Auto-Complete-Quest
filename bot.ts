import { ClientQuest } from './client';

// ✅ Lê o modo do env — o index.ts manda QUEST_MODE
const MODE = process.env.QUEST_MODE ?? process.env.MODE ?? '';

if (MODE === 'profile') {
	console.log('[profile] Iniciando...');

	// ✅ Imprime o perfil BASE imediatamente (id, username, avatar vêm do /users/@me)
	const baseProfile = {
		id: data.user.id,
		username: data.user.username,
		global_name: (data.user as any).global_name ?? null,
		avatar: (data.user as any).avatar ?? null,
		quests: 0,
	};

	// ✅ UMA linha só — a regex do index.ts é linha-a-linha
	console.log(`__PROFILE_JSON_START__${JSON.stringify(baseProfile)}__PROFILE_JSON_END__`);
	console.log('[profile] Perfil base enviado');

	// ✅ Tenta buscar quests (timeout curto)
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

	try {
		await client.destroy();
	} catch {}
	process.exit(0);
}

// ✅ MODO ORBS — puxa /quests/@me e soma orb_quantity
if (MODE === 'orbs') {
	console.log('[orbs] Iniciando...');

	try {
		// ✅ Usa o endpoint REAL que o questManager usa: /quests/@me
		const response = (await client.rest.get('/quests/@me')) as any;
		const quests = response?.quests ?? [];

		let totalOrbs = 0;
		const breakdown: { name: string; orbs: number }[] = [];

		for (const q of quests) {
			const rewards = q?.config?.rewards_config?.rewards ?? [];
			const orbQty = rewards.reduce(
				(acc: number, r: any) => acc + (r?.orb_quantity ?? 0),
				0
			);
			if (orbQty > 0) {
				const name = q?.config?.messages?.quest_name ?? 'Quest';
				totalOrbs += orbQty;
				breakdown.push({ name, orbs: orbQty });
			}
		}

		// ✅ Também inclui quests excluídas (caso o user não possa entrar)
		const excluded = response?.excluded_quests ?? [];
		for (const q of excluded) {
			const rewards = q?.config?.rewards_config?.rewards ?? [];
			const orbQty = rewards.reduce(
				(acc: number, r: any) => acc + (r?.orb_quantity ?? 0),
				0
			);
			if (orbQty > 0) {
				const name = q?.config?.messages?.quest_name ?? 'Quest (excluída)';
				totalOrbs += orbQty;
				breakdown.push({ name, orbs: orbQty });
			}
		}

		const orbsData = { total: totalOrbs, breakdown };
		console.log(`__ORBS_JSON_START__${JSON.stringify(orbsData)}__ORBS_JSON_END__`);
		console.log(`[orbs] Total: ${totalOrbs} Orbs em ${breakdown.length} quest(s)`);
	} catch (err: any) {
		console.log(`[orbs] Falha: ${err?.message ?? err}`);
		const orbsData = { total: 0, breakdown: [] };
		console.log(`__ORBS_JSON_START__${JSON.stringify(orbsData)}__ORBS_JSON_END__`);
	}

	try {
		await client.destroy();
	} catch {}
	process.exit(0);
}

// ✅ Modos de quest (mantém o comportamento original do seu bot.ts)
if (
	MODE === 'sequential_no_delay' ||
	MODE === 'sequential_delay' ||
	MODE === 'all_parallel' ||
	MODE === 'all_delay'
) {
	console.log(`[quest] Modo: ${MODE}`);
	// ... aqui entra o SEU código original de quest (o que você já tinha) ...
	// Não toquei nesse bloco — só garanti que o MODE chega certo.
}
