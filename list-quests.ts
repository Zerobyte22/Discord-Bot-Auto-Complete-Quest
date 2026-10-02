import { GatewayDispatchEvents } from 'discord-api-types/v10';
import { ClientQuest } from './src/client';

const client = new ClientQuest(process.env.TOKEN!);

// Converte snowflake do Discord em data (epoch Discord = 2015-01-01)
function snowflakeToDate(id: string): Date {
	const DISCORD_EPOCH = 1420070400000n;
	const ms = (BigInt(id) >> 22n) + DISCORD_EPOCH;
	return new Date(Number(ms));
}

client.once(GatewayDispatchEvents.Ready, async ({ data }) => {
	try {
		await client.fetchQuests(false);
		const quests = client.questManager!.filterQuestsValidToDo();

		const createdAt = snowflakeToDate(data.user.id);
		const ageDays = Math.floor((Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24));

		const result = {
			user: {
				id: data.user.id,
				username: data.user.username,
				global_name: (data.user as any).global_name ?? null,
				avatar: (data.user as any).avatar ?? null,
				created_at: createdAt.toISOString(),
				age_days: ageDays,
			},
			quests: quests.map((q) => ({
				id: q.id,
				name: q.config.messages.quest_name,
				game: q.config.messages.game_title,
				publisher: q.config.messages.game_publisher,
				expires_at: q.config.expires_at,
				tasks: Object.keys(q.config.task_config_v2.tasks),
			})),
		};

		console.log('__QUESTS_JSON_START__');
		console.log(JSON.stringify(result));
		console.log('__QUESTS_JSON_END__');
	} catch (err: any) {
		console.error('Erro:', err?.message ?? err);
	}

	await client.destroy();
});

process.on('unhandledRejection', (r) => console.error('Unhandled:', r));
client.connect();
