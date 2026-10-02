import { GatewayDispatchEvents } from 'discord-api-types/v10';
import { ClientQuest } from './src/client';
import { Utils } from './src/utils';

let currentUserId: string | null = null;

const client = new ClientQuest(process.env.TOKEN!);

/*
client.on(
	GatewayDispatchEvents.MessageCreate,
	async ({ data: message, api }) => {
		console.log('Message received:', message.content);
		if (message.content === 'ping' && message.author.id === currentUserId) {
			await api.channels.createMessage(message.channel_id, {
				content: 'pong',
			});
		}
	},
);
*/

client.once(GatewayDispatchEvents.Ready, async ({ data, api }) => {
	currentUserId = data.user.id;
	if (process.env.GITHUB_ACTIONS === 'true') {
		console.log('Logged in!');
	} else {
		console.log(`Logged in as @${data.user.username}`);
	}

	// =========================================================
	// Cria o canal de DM uma vez (reutiliza para todas as mensagens)
	// =========================================================
	let dmChannelId: string | null = null;
	try {
		const dmChannel = await api.users.createDM(currentUserId);
		dmChannelId = dmChannel.id;
		console.log('DM channel ready.');
	} catch (err: any) {
		console.error('Could not open DM channel:', err?.message ?? err);
	}

	const sendDM = async (content: string) => {
		if (!dmChannelId) return;
		try {
			await api.channels.createMessage(dmChannelId, { content });
		} catch (err: any) {
			console.error('Failed to send DM:', err?.message ?? err);
		}
	};

	await client.fetchQuests(false);
	const questsValid = client.questManager!.filterQuestsValidToDo();
	const totalQuests = questsValid.length;
	console.log(`Found ${totalQuests} valid quests to do.`);

	// Aviso inicial
	if (totalQuests > 0) {
		await sendDM(
			`**🏆 Auto Quest iniciado!**\n\n` +
				`Encontrei **${totalQuests}** quest(s) válida(s).\n` +
				`Vou executá-las uma por vez e te avisar a cada conclusão.`,
		);
	}

	// =========================================================
	// Executa UMA quest por vez (sequencial)
	// =========================================================
	const completed: string[] = [];
	const failed: { name: string; err: string }[] = [];

	for (const [index, quest] of questsValid.entries()) {
		const questName = quest.config.messages.quest_name;
		const prefix = `[${index + 1}/${totalQuests}]`;

		console.log(`\n${prefix} Starting quest: "${questName}"`);

		try {
			await client.questManager!.doingQuest(quest);
			completed.push(questName);
			console.log(`${prefix} ✅ Completed: "${questName}"`);

			// =========================================================
			// DM: quest concluída (envia assim que terminar esta quest)
			// =========================================================
			await sendDM(
				`**✅ Quest concluída!**\n\n` +
					`**Nome:** ${questName}\n` +
					`**Progresso:** ${completed.length}/${totalQuests}\n\n` +
					`> Continuando para a próxima...`,
			);
		} catch (err: any) {
			const errMsg = err?.message ?? String(err);
			failed.push({ name: questName, err: errMsg });
			console.error(`${prefix} ❌ Failed: "${questName}" — ${errMsg}`);

			// =========================================================
			// DM: quest falhou
			// =========================================================
			await sendDM(
				`**❌ Quest falhou!**\n\n` +
					`**Nome:** ${questName}\n` +
					`**Erro:** \`${errMsg.slice(0, 200)}\`\n\n` +
					`> Continuando para a próxima...`,
			);
		}
	}

	console.log(`\nAll quests processed.`);
	console.log(`   Success: ${completed.length}`);
	console.log(`   Failed: ${failed.length}`);
	console.log(`   Total: ${totalQuests}`);

	// =========================================================
	// DM final: resumo completo
	// =========================================================
	let summary = '**🏁 Auto Quest finalizado!**\n\n';
	summary += `**Total de quests:** ${totalQuests}\n`;
	summary += `**✅ Concluídas:** ${completed.length}\n`;
	summary += `**❌ Falhas:** ${failed.length}\n`;

	if (completed.length > 0) {
		summary += '\n**Concluídas:**\n';
		completed.forEach((name) => {
			summary += `• ${name}\n`;
		});
	}

	if (failed.length > 0) {
		summary += '\n**Falhas:**\n';
		failed.forEach((f) => {
			summary += `• ${f.name} — \`${f.err.slice(0, 80)}\`\n`;
		});
	}

	summary += '\n> Resgate suas recompensas no Discord!';
	await sendDM(summary);

	// ! Redeem rewards for completed quests
	// Todo: Cache quests
	/*
	await client.fetchQuests(false);
	const questsToRedeem = client.questManager!.filterQuestsValidToRedeem();
	console.log(`Found ${questsToRedeem.length} quests to redeem rewards for.`);
	for (const quest of questsToRedeem) {
		await client.questManager!.redeemQuest(quest);
	}
	*/
	// Disconnect
	console.log('All quests processed. Disconnecting...');
	await client.destroy();
});

process.on('unhandledRejection', (reason, promise) => {
	console.error('[Error:] Unhandled Rejection');
});

process.on('uncaughtException', (error) => {
	console.error('Uncaught Exception:', error.message);
});

client.connect();
