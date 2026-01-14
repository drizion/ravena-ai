const Logger = require("../utils/Logger");

/**
 * Serviço para monitorar estabilidade das ravenas
 */
class StabilityMonitor {
	constructor(config = {}) {
		this.logger = new Logger("stability-monitor");
		this.instances = config.instances || [];
		this.history = {};

		setTimeout(
			(is) => {
				this.logger.info(
					`[StabilityMonitor] Inicializado monitorando ${is.length} bots: ${is.map((i) => i.id).join(", ")}`
				);
			},
			15000,
			this.instances
		);

		setInterval(
			(logg, ists, hst) => {
				const currentTs = Math.round(+new Date() / 1000);
				for (const bIns of ists) {
					if (!hst[bIns.id]) {
						logg.info(`[checkStability] ${bIns.id} Inicializado`);
						hst[bIns.id] = currentTs;
					}
					const dif = currentTs - hst[bIns.id];

					logg.info(`[checkStability] ${bIns.id}: ${dif}s`);

					// Os bots enviam mensagem de loadReport a cada 10 minutos
					// então é o tempo limite pra não ver msgs uma das outras
					if (dif > 660) {
						// 11 Minutos
						logg.warn(`[checkStability] ${bIns.id}: DELAY ELEVADO! (${dif}s) Reiniciando.`);
						//bIns.restartBot(`O delay está elevado, por isso o bot será reiniciado.`).catch(err => this.logger.error(`Erro ao reiniciar bot ${bIns.id} por delay elevado:`, err));
						hst = currentTs + 60 * 5; // Pra evitar que seja reiniciado novamente, adiciona 5 minutos no tempo
					}
				}
			},
			5 * 60 * 1000,
			this.logger,
			this.instances,
			this.history
		);
	}

	// Recebe direto do eventHandler, então msg é um objeto do whatsapp
	async registerBotMessage(msg) {
		if (msg.from.includes("@g")) {
			// Só considera mensagens de grupo, elas não vão se comunicar no PV
			let author = msg.author;
			if (!author) {
				this.logger.info(`[registerBotMessage] Msg não tinha author, pegando contato`);
				const sender = await msg.getContact();
				author = sender.id._serialized;
			}

			// Sistema de estabilidade onde as ravenas monitoram as outras ravenas
			for (const bIns of this.instances) {
				if (author.includes(bIns.phoneNumber)) {
					// Recebi mensagem de algum bot
					this.logger.info(
						`[registerBotMessage] Detectada mensagem de ${bIns.id} (${bIns.phoneNumber})`
					);
					this.history[bIns.id] = Math.round(+new Date() / 1000);
				}
			}
		}
	}
}

module.exports = StabilityMonitor;
