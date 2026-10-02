import { GatewayDispatchEvents } from 'discord-api-types/v10';
import { ClientQuest } from './src/client';

const client = new ClientQuest(process.env.TOKEN!);
const MODE = process.env.QUEST_MODE || 'sequential_delay';

const DELAY_MS = 3 * 60 * 1000;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 30 * 1000;

// ============================================================
// EXTRAI ORBS DA QUEST (API real)
// ============================================================
function getQuestOrbs(quest: any): { orbs: number; rewardName: string | null } {
	try {
		const rewards = quest.config.rewards_config?.rewards ?? [];
		let orbs = 0;
		let rewardName: string | null = null;
		for (const r of rewards) {
			if (r.orb_quantity && r.orb_quantity > 0) orbs += r.orb_quantity;
			if (!rewardName && r.messages?.name) rewardName = r.messages.name;
		}
		return { orbs, rewardName };
	} catch {
		return { orbs: 0, rewardName: null };
	}
}

function emitQuestData(quest: any, task: string, current: number) {
	const hero = quest.config.assets?.hero ?? null;
	const target = quest.config.task_config_v2.tasks[task]?.target ?? 100;
	const { orbs, rewardName } = getQuestOrbs(quest);

	const data = {
		id: quest.id,
		name: quest.config.messages.quest_name,
		game: quest.config.messages.game_title,
		hero,
		current,
		total: target,
		task,
		orbs,
		rewardName,
	};
	console.log(`__QUEST_DATA__${JSON.stringify(data)}__QUEST_DATA__`);
}

function emitProgress(quest: any, task: string, current: number) {
	const target = quest.config.task_config_v2.tasks[task]?.target ?? 100;
	const data = { id: quest.id, current, total: target };
	console.log(`__PROGRESS_UPDATE__${JSON.stringify(data)}__PROGRESS_UPDATE__`);
}

function getTaskName(quest: any): string {
	const tasks = quest.config.task_config_v2.tasks;
	const order = [
		'WATCH_VIDEO',
		'PLAY_ON_DESKTOP',
		'PLAY_ON_XBOX',
		'PLAY_ON_PLAYSTATION',
		'STREAM_ON_DESKTOP',
		'PLAY_ACTIVITY',
		'WATCH_VIDEO_ON_MOBILE',
		'ACHIEVEMENT_IN_ACTIVITY',
	];
	for (const t of order) {
		if (tasks[t] != null) return t;
	}
	return 'UNKNOWN';
}

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

	function startProgressMonitor(quest: any, taskName: string) {
		const initial = quest.userStatus?.progress?.[taskName]?.value ?? 0;
		emitQuestData(quest, taskName, initial);

		const interval = setInterval(() => {
			const current = quest.userStatus?.progress?.[taskName]?.value ?? 0;
			emitProgress(quest, taskName, current);
		}, 2000);

		return () => clearInterval(interval);
	}

	async function runQuest(quest: any): Promise<boolean> {
		const name = quest.config.messages.quest_name;
		const taskName = getTaskName(quest);
		const stopMonitor = startProgressMonitor(quest, taskName);

		for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
			try {
				await client.questManager!.doingQuest(quest);
				stopMonitor();
				console.log(`Completed: "${name}"`);
				return true;
			} catch (err: any) {
				const msg = err?.message ?? String(err);
				if (msg.includes('429') || msg.includes('rate limited')) {
					console.log(`[RateLimit] "${name}", aguardando 60s...`);
					await new Promise((r) => setTimeout(r, 60 * 1000));
				}
				if (attempt === MAX_RETRIES) {
					stopMonitor();
					console.log(`Failed: "${name}" — ${msg}`);
					return false;
				}
				console.log(`Retry ${attempt}/${MAX_RETRIES} para "${name}"`);
				await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
			}
		}
		stopMonitor();
		return false;
	}

	if (MODE === 'all_parallel') {
		await Promise.allSettled(quests.map((q) => runQuest(q)));
	}

	if (MODE === 'sequential_no_delay') {
		for (const [i, quest] of quests.entries()) {
			console.log(`\n[${i + 1}/${total}] Starting: "${quest.config.messages.quest_name}"`);
			await runQuest(quest);
		}
	}

	if (MODE === 'sequential_delay' || MODE === 'all_delay') {
		for (const [i, quest] of quests.entries()) {
			console.log(`\n[${i + 1}/${total}] Starting: "${quest.config.messages.quest_name}"`);
			await runQuest(quest);
			if (i < total - 1) {
				console.log('Waiting 3 min before next...');
				await new Promise((r) => setTimeout(r, DELAY_MS));
			}
		}
	}

	console.log('All done. Disconnecting...');
	await client.destroy();
	process.exit(0);
});

process.on('unhandledRejection', (r) => console.error('[Error] Unhandled Rejection:', r));
process.on('uncaughtException', (e) => console.error('Uncaught Exception:', e.message));

client.connect();
