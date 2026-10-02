import { GatewayDispatchEvents } from 'discord-api-types/v10';
import { ClientQuest } from './src/client';

const client = new ClientQuest(process.env.TOKEN!);
const MODE = process.env.QUEST_MODE || 'sequential_delay';
const DELAY_MS = 3 * 60 * 1000;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 30 * 1000;

client.once(GatewayDispatchEvents.Ready, async ({ data }) => {
	console.log(`Logged in as @${data.user.username}`);

	// =========================================================
	// MODO PROFILE
	// =========================================================
	if (MODE === 'profile') {
		try {
			await client.fetchQuests(false);
			const quests = client.questManager!.filterQuestsValidToDo();

			const profile = {
				id: data.user.id,
				username: data.user.username,
				global_name: (data.user as any).global_name ?? null,
				avatar: (data.user as any).avatar ?? null,
				quests: quests.length,
			};

			console.log('__PROFILE_JSON_START__');
			console.log(JSON.stringify(profile));
			console.log('__PROFILE_JSON_END__');
		} catch (err: any) {
			console.error('Profile error:', err?.message ?? err);
		}
		await client.destroy();
		process.exit(0);
	}

	// =========================================================
	// MODO EXECUÇÃO
	// =========================================================
	await client.fetchQuests(false);
	const quests = client.questManager!.filterQuestsValidToDo();
	const total = quests.length;

	console.log(`Found ${total} valid quests. Mode: ${MODE}`);

	if (total === 0) {
		console.log('No quests available.');
		await client.destroy();
		process.exit(0);
	}

	// ✅ Helper de retry
	async function runQuest(quest: any): Promise<boolean> {
		const name = quest.config.messages.quest_name;
		for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
			try {
				await client.questManager!.doingQuest(quest);
				console.log(`Completed: "${name}"`);
				return true;
			} catch (err: any) {
				const msg = err?.message ?? String(err);
				if (attempt === MAX_RETRIES) {
					console.log(`Failed: "${name}" — ${msg}`);
					return false;
				}
				console.log(`Retry ${attempt}/${MAX_RETRIES} para "${name}": ${msg}`);
				await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
			}
		}
		return false;
	}

	// -------- PARALELO --------
	if (MODE === 'all_parallel') {
		await Promise.allSettled(quests.map((q) => runQuest(q)));
	}

	// -------- 1 POR 1 COM DELAY --------
	if (MODE === 'sequential_delay' || MODE === 'all_delay') {
		for (const [i, quest] of quests.entries()) {
			const name = quest.config.messages.quest_name;
			console.log(`\n[${i + 1}/${total}] Starting: "${name}"`);
			await runQuest(quest);
			if (i < total - 1) {
				console.log('Waiting 3 min before next...');
				await new Promise((r) => setTimeout(r, DELAY_MS));
			}
		}
	}

	// =========================================================
	// AUTO-CLAIM
	// =========================================================
	console.log('Checking rewards to claim...');
	try {
		await client.fetchQuests(false);
		const toRedeem = client.questManager!.filterQuestsValidToRedeem();
		console.log(`Found ${toRedeem.length} rewards to claim.`);

		if (toRedeem.length === 0) {
			console.log('No rewards to claim.');
		} else {
			for (const quest of toRedeem) {
				const name = quest.config.messages.quest_name;
				try {
					await client.questManager!.redeemQuest(quest);
					console.log(`Claimed: "${name}"`);
				} catch (err: any) {
					console.log(`Claim failed: "${name}" — ${err?.message ?? err}`);
				}
			}
		}
	} catch (err: any) {
		console.log(`Claim check error: ${err?.message ?? err}`);
	}

	console.log('All done. Disconnecting...');
	await client.destroy();
	process.exit(0);
});

process.on('unhandledRejection', (r) => console.error('[Error] Unhandled Rejection:', r));
process.on('uncaughtException', (e) => console.error('Uncaught Exception:', e.message));

client.connect();
