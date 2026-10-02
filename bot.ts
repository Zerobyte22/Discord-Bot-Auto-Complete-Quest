import { GatewayDispatchEvents } from 'discord-api-types/v10';
import { ClientQuest } from './src/client';

let currentUserId: string | null = null;

const client = new ClientQuest(process.env.TOKEN!);

// Delay entre cada quest (3 minutos)
const DELAY_BETWEEN_QUESTS_MS = 3 * 60 * 1000;

client.once(GatewayDispatchEvents.Ready, async ({ data, api }) => {
	currentUserId = data.user.id;
	console.log(`Logged in as @${data.user.username}`);

	// =========================================================
	// Abre canal de DM
	// =========================================================
	let dmChannelId: string | null = null;
	try {
		const dm = await api.users.createDM(currentUserId);
		dmChannelId = dm.id;
		console.log('DM channel ready.');
	} catch (err: any) {
		console.error('DM error:', err?.message ?? err);
	}

	const sendDM = async (content: string) => {
		if (!dmChannelId) return;
		try {
			await api.channels.createMessage(dmChannelId, { content });
		} catch (err: any) {
			console.error('DM send error:', err?.message ?? err);
		}
	};

	// =========================================================
	// Detecta TODAS as quests disponíveis
	// =========================================================
	await client.fetchQuests(false);
	const questsValid = client.questManager!.filterQuestsValidToDo();
	const total = questsValid.length;

	console.log(`Found ${total} valid quests.`);
	await sendDM(
		`👻 **Auto Quest iniciado!**\n\n` +
			`Detectei **${total}** quest(s) disponíveis.\n` +
			`Vou executar **uma por vez** com **3 minutos de intervalo** entre cada.\n\n` +
			`Você receberá uma DM a cada conclusão.`
	);

	if (total === 0) {
		await sendDM('⚠️ Nenhuma quest disponível no momento.');
		await client.destroy();
		return;
	}

	// =========================================================
	// Executa 1 por 1 com delay de 3 minutos
	// =========================================================
	const completed: string[] = [];
	const failed: { name: string; err: string }[] = [];

	for (const [i, quest] of questsValid.entries()) {
		const name = quest.config.messages.quest_name;
		const game = quest.config.messages.game_title;
		const prefix = `[${i + 1}/${total}]`;

		console.log(`\n${prefix} Starting: "${name}"`);

		try {
			await client.questManager!.doingQuest(quest);
			completed.push(name);
			console.log(`${prefix} ✅ Completed: "${name}"`);

			// DM de conclusão
			await sendDM(
				`✅ **Quest concluída!**\n\n` +
					`**Nome:** ${name}\n` +
					`**Jogo:** ${game}\n` +
					`**Progresso:** ${completed.length}/${total}`
			);
		} catch (err: any) {
			const msg = err?.message ?? String(err);
			failed.push({ name, err: msg });
			console.error(`${prefix} ❌ Failed: "${name}" — ${msg}`);

			await sendDM(
				`❌ **Quest falhou**\n\n` +
					`**Nome:** ${name}\n` +
					`**Erro:** \`${msg.slice(0, 200)}\``
			);
		}

		// Delay de 3 minutos antes da próxima (exceto depois da última)
		if (i < total - 1) {
			console.log(`${prefix} Aguardando 3 minutos antes da próxima quest...`);
			await sendDM(
				`⏳ Aguardando **3 minutos** antes da próxima quest... (${i + 1}/${total} feitas)`
			);
			await new Promise((r) => setTimeout(r, DELAY_BETWEEN_QUESTS_MS));
		}
	}

	// =========================================================
	// Auto-redeem
	// =========================================================
	try {
		await client.fetchQuests(false);
		const toRedeem = client.questManager!.filterQuestsValidToRedeem();
		for (const quest of toRedeem) {
			const name = quest.config.messages.quest_name;
			try {
				await client.questManager!.redeemQuest(quest);
				await sendDM(`🎁 **Recompensa resgatada:** ${name}`);
			} catch (err: any) {
				console.error(`Redeem error: ${err?.message ?? err}`);
			}
		}
	} catch (err: any) {
		console.error(`Auto-redeem error: ${err?.message ?? err}`);
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
	summary += '\n👻 Resgate suas recompensas no Discord!';

	await sendDM(summary);

	console.log('All quests processed. Disconnecting...');
	await client.destroy();
});

process.on('unhandledRejection', (r) => console.error('[Error] Unhandled Rejection:', r));
process.on('uncaughtException', (e) => console.error('Uncaught Exception:', e.message));

client.connect();
