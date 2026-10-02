if (MODE === 'profile') {
	console.log('[profile] Iniciando...');

	// ✅ 1. Imprime o perfil BASE imediatamente (não depende de fetchQuests)
	const baseProfile = {
		id: data.user.id,
		username: data.user.username,
		global_name: (data.user as any).global_name ?? null,
		avatar: (data.user as any).avatar ?? null,
		quests: 0,
	};

	console.log('__PROFILE_JSON_START__');
	console.log(JSON.stringify(baseProfile));
	console.log('__PROFILE_JSON_END__');
	console.log('[profile] Perfil base enviado');

	// ✅ 2. Tenta buscar quests (timeout curto)
	try {
		const timeoutPromise = new Promise((_, reject) =>
			setTimeout(() => reject(new Error('timeout')), 15 * 1000)
		);
		await Promise.race([client.fetchQuests(false), timeoutPromise]);
		const quests = client.questManager!.filterQuestsValidToDo();

		const fullProfile = { ...baseProfile, quests: quests.length };
		console.log('__PROFILE_JSON_START__');
		console.log(JSON.stringify(fullProfile));
		console.log('__PROFILE_JSON_END__');
		console.log(`[profile] Perfil completo: ${quests.length} quests`);
	} catch (err: any) {
		console.log(`[profile] fetchQuests falhou: ${err?.message ?? err}`);
	}

	await client.destroy();
	process.exit(0);
}
