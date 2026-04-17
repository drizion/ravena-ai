const axios = require("axios");
const Logger = require("./Logger");

const logger = new Logger("CurrencyConverter");

class CurrencyConverter {
	constructor() {
		this.rate = 5.0;
		this.lastUpdate = null;
	}

	/**
	 * Atualiza a cotação do dólar para real
	 * @returns {Promise<number>}
	 */
	async updateRate() {
		try {
			logger.info("Atualizando cotação do dólar...");
			const response = await axios.get("https://economia.awesomeapi.com.br/json/last/USD-BRL");
			const data = response.data;

			if (data && data.USDBRL && data.USDBRL.bid) {
				this.rate = parseFloat(data.USDBRL.bid);
				this.lastUpdate = new Date();
				logger.info(`Cotação atualizada: R$ ${this.rate.toFixed(2)}`);
			} else {
				throw new Error("Resposta da API inválida");
			}
		} catch (error) {
			logger.error(`Erro ao atualizar cotação: ${error.message}. Usando fallback R$ 5.00`);
			this.rate = 5.0;
		}
		return this.rate;
	}

	/**
	 * Obtém a cotação atual (já carregada)
	 * @returns {number}
	 */
	getRate() {
		return this.rate;
	}

	/**
	 * Converte USD para BRL
	 * @param {number} usd
	 * @returns {number}
	 */
	convertToBRL(usd) {
		return usd * this.rate;
	}

	/**
	 * Formata um valor em reais
	 * @param {number} value
	 * @returns {string}
	 */
	formatBRL(value) {
		return new Intl.NumberFormat("pt-BR", {
			style: "currency",
			currency: "BRL"
		}).format(value);
	}
}

// Singleton
module.exports = new CurrencyConverter();
