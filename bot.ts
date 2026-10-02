import { GatewayDispatchEvents } from 'discord-api-types/v10';
import { ClientQuest } from './src/client';

let currentUserId: string | null = null;

const client = new ClientQuest(process.env.TOKEN!);

// Filtro opcional vindo do index.ts via env (executa apenas 1 quest)
const QUEST_FILTER = process.env.QUEST_NAME?.trim() || null;

client.once(GatewayDispatchEvents.Ready, async ({ data, api }) => {
	currentUserId = data.user.id;
	console.log(
		process.env.GITHUB_ACTIONS === 'true'
			? 'Logged in!'
			: `Logged in as @${data.user.username}`
	);

	// =========================================================
	// Abre canal de DM para notificar o próprio usuário
	// =========================================================
	let dmChannelId: string | null = null;
	try {
		const dm = await api.users.createDM(currentUserId);
		dmChannelId = dm.id;
		console.log('DM channel ready.');
	} catch (err: any) {
		console.error('Could not open DM:', err?.message ?? err);
	}

	const sendDM = async (content: string) => {
		if (!dmChannelId) return;
		try {
			await api.channels.createMessage(dmChannelId, { content });
		} catch (err: any) {
			console.error('DM falhou:', err?.message ?? err);
		}
	};

	// =========================================================
	// Busca quests
	// =========================================================
	await client.fetchQuests(false);
	let questsValid = client.questManager!.filterQuestsValidToDo();

	if (QUEST_FILTER) {
		questsValid = questsValid.filter(
			(q) => q.config.messages.quest_name === QUEST_FILTER
		);
		console.log(`Filtro ativo: "${QUEST_FILTER}"`);
	}

	const total = questsValid.length;
	console.log(`Found ${total} valid quests to do.`);

	if (total > 0) {
		await sendDM(
			`🏆 **Auto Quest iniciado!**\n\n` +
				`Encontrei **${total}** quest(s).\n` +
				`Vou executá-las **uma por vez** e te avisar a cada conclusão.`
		);
	}

	// =========================================================
	// Executa 1 POR VEZ (sequencial)
	// =========================================================
	const completed: string[] = [];
	const failed: { name: string; err: string }[] = [];

	for (const [i, quest] of questsValid.entries()) {
		const name = quest.config.messages.quest_name;
		const prefix = `[${i + 1}/${total}]`;

		console.log(`\n${prefix} Starting: "${name}"`);

		try {
			await client.questManager!.doingQuest(quest);
			completed.push(name);
			console.log(`${prefix} ✅ Completed: "${name}"`);

			await sendDM(
				`✅ **Quest concluída!**\n\n` +
					`**Nome:** ${name}\n` +
					`**Progresso:** ${completed.length}/${total}\n\n` +
					`> Continuando para a próxima...`
			);
		} catch (err: any) {
			const msg = err?.message ?? String(err);
			failed.push({ name, err: msg });
			console.error(`${prefix} ❌ Failed: "${name}" — ${msg}`);

			await sendDM(
				`❌ **Quest falhou**\n\n` +
					`**Nome:** ${name}\n` +
					`**Erro:** \`${msg.slice(0, 200)}\`\n\n` +
					`> Continuando...`
			);
		}
	}

	console.log(`\nAll quests processed.`);
	console.log(`   Success: ${completed.length}`);
	console.log(`   Failed: ${failed.length}`);
	console.log(`   Total: ${total}`);

	// =========================================================
	// Auto-redeem de recompensas
	// =========================================================
	try {
		await client.fetchQuests(false);
		const toRedeem = client.questManager!.filterQuestsValidToRedeem();
		console.log(`Found ${toRedeem.length} to redeem.`);

		for (const quest of toRedeem) {
			const name = quest.config.messages.quest_name;
			try {
				await client.questManager!.redeemQuest(quest);
				console.log(`🎁 Redeemed: "${name}"`);
				await sendDM(`🎁 **Recompensa resgatada:** ${name}`);
			} catch (err: any) {
				console.error(`Redeem falhou em "${name}": ${err?.message ?? err}`);
			}
		}
	} catch (err: any) {
		console.error(`Erro no auto-redeem: ${err?.message ?? err}`);
	}

	// =========================================================
	// DM final
	// =========================================================
	let summary = '🏁 **Auto Quest finalizado!**\n\n';
	summary += `**Total:** ${total}\n`;
	summary += `**✅ Concluídas:** ${completed.length}\n`;
	summary += `**❌ Falhas:** ${failed.length}\n`;

	if (completed.length > 0) {
		summary += '\n**Concluídas:**\n';
		completed.forEach((n) => (summary += `• ${n}\n`));
	}
	if (failed.length > 0) {
		summary += '\n**Falhas:**\n';
		failed.forEach((f) => (summary += `• ${f.name} — \`${f.err.slice(0, 80)}\`\n`));
	}
	summary += '\n> Resgate suas recompensas no Discord!';

	await sendDM(summary);

	console.log('All quests processed. Disconnecting...');
	await client.destroy();
});

process.on('unhandledRejection', (r) => console.error('[Error] Unhandled Rejection:', r));
process.on('uncaughtException', (e) => console.error('Uncaught Exception:', e.message));

client.connect();
