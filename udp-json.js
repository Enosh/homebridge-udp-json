'use strict';

const dgram = require('dgram');
var logger = require("mcuiot-logger").logger;
const moment = require('moment');
var os = require("os");
var hostname = os.hostname();

let Service, Characteristic;
var FakeGatoHistoryService;

module.exports = (homebridge) => {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  FakeGatoHistoryService = require('fakegato-history')(homebridge);

  homebridge.registerAccessory('homebridge-udp-json', 'UDPJSON', UDPJSONPlugin);
};

class UDPJSONPlugin
{
  constructor(log, config) {
    this.log = log;
    this.name = config.name;
    this.name_temperature = config.name_temperature || this.name;
    this.name_humidity = config.name_humidity || this.name;
    this.listen_port = config.listen_port || 8268;
    this.spreadsheetId = config['spreadsheetId'];
    if (this.spreadsheetId) {
      this.log_event_counter = 59;
      this.logger = new logger(this.spreadsheetId);
    }

    this.informationService = new Service.AccessoryInformation();

    this.informationService
      .setCharacteristic(Characteristic.Manufacturer, "Bosch")
      .setCharacteristic(Characteristic.Model, "RPI-UDPJSON")
      .setCharacteristic(Characteristic.SerialNumber, hostname + "-" + this.device)
      .setCharacteristic(Characteristic.FirmwareRevision, require('./package.json').version);

    this.temperatureService = new Service.TemperatureSensor(this.name_temperature);

    this.temperatureService
      .getCharacteristic(Characteristic.CurrentTemperature)
      .setProps({
        minValue: -100,
        maxValue: 100
      });

    this.humidityService = new Service.HumiditySensor(this.name_humidity);

    this.server = dgram.createSocket('udp4');

    this.server.on('error', (err) => {
      console.log(`udp server error:\n${err.stack}`);
      this.server.close();
    });

    this.temperatureService.log = this.log;
    this.loggingService = new FakeGatoHistoryService("weather", this.temperatureService);

    this.server.on('message', (msg, rinfo) => {
      let json;
      try {
          json = JSON.parse(msg);
      } catch (e) {
          this.log(`failed to decode JSON: ${e}`);
          return;
      }

      const temperature_c = json.temperature_c;
      const pressure_hPa = json.pressure_hPa;
      // const altitude_m = json.altitude_m; // TODO
      const humidity_percent = json.humidity_percent;

      this.log_event_counter = this.log_event_counter + 1;
      if (this.log_event_counter > 59) {
        this.loggingService.addEntry({
          time: moment().unix(),
          temp: roundInt(temperature_c),
          pressure: roundInt(pressure_hPa),
          humidity: roundInt(humidity_percent)
        });
        if (this.spreadsheetId) {
          this.logger.storeBME(this.name, 0, roundInt(temperature_c), roundInt(humidity_percent), roundInt(pressure_hPa));
        }
        this.log(`received udp: ${msg} from ${rinfo.address}, logged to FakeGato; spreadsheets: ${this.spreadsheetId ? "yes" : "no"}`);
        this.log_event_counter = 0;
      }

      this.temperatureService
        .getCharacteristic(Characteristic.CurrentTemperature)
        .setValue(temperature_c);

      this.humidityService
        .getCharacteristic(Characteristic.CurrentRelativeHumidity)
        .setValue(humidity_percent);
    });

    this.server.bind(this.listen_port);

  }

  getServices() {
    return [this.informationService, this.temperatureService, this.humidityService, this.loggingService]
  }
}

function roundInt(string) {
  return Math.round(parseFloat(string) * 10) / 10;
}
