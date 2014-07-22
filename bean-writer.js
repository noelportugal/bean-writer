var noble = require('noble');
var crc = require('crc');
var currentPeripheral;

// I noticed that OS X returns different uuids, update with your uuid
//var uuid = 'xxxxxxxxxxxx'; // Raspberry Pi 12 chars
var uuid = 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'; // Mac OS X 32 chars

var serviceUUIDs = [
'a495ff10c5b14b44b5121370f02d74de', // Serial Transport Service
'a495ff20c5b14b44b5121370f02d74de'  // Scratch Service
];
var characteristicUUIDs = [
'a495ff11c5b14b44b5121370f02d74de', // Serial Characteristic index [0]
'a495ff21c5b14b44b5121370f02d74de', // Scratch 1 index [1]
'a495ff22c5b14b44b5121370f02d74de', // Scratch 2 index [2]
'a495ff23c5b14b44b5121370f02d74de', // Scratch 3 index [3]
'a495ff24c5b14b44b5121370f02d74de'  // Scratch 4 index [4]
];

var rrsiThreshold = -70;
var state = '';
var zone = 'outside'; // This will ensure that writing will only occur once inside the rrsi zone threshold

var commands = {
    MSG_ID_SERIAL_DATA        : new Buffer([0x00, 0x00]),
    MSG_ID_BT_SET_ADV         : new Buffer([0x05, 0x00]),
    MSG_ID_BT_SET_CONN        : new Buffer([0x05, 0x02]),
    MSG_ID_BT_SET_LOCAL_NAME  : new Buffer([0x05, 0x04]),
    MSG_ID_BT_SET_PIN         : new Buffer([0x05, 0x06]),
    MSG_ID_BT_SET_TX_PWR      : new Buffer([0x05, 0x08]),
    MSG_ID_BT_GET_CONFIG      : new Buffer([0x05, 0x10]),
    MSG_ID_BT_ADV_ONOFF       : new Buffer([0x05, 0x12]),
    MSG_ID_BT_SET_SCRATCH     : new Buffer([0x05, 0x14]),
    MSG_ID_BT_GET_SCRATCH     : new Buffer([0x05, 0x15]),
    MSG_ID_BT_RESTART         : new Buffer([0x05, 0x20]),
    MSG_ID_BL_CMD             : new Buffer([0x10, 0x00]),
    MSG_ID_BL_FW_BLOCK        : new Buffer([0x10, 0x01]),
    MSG_ID_BL_STATUS          : new Buffer([0x10, 0x02]),
    MSG_ID_CC_LED_WRITE       : new Buffer([0x20, 0x00]),
    MSG_ID_CC_LED_WRITE_ALL   : new Buffer([0x20, 0x01]),
    MSG_ID_CC_LED_READ_ALL    : new Buffer([0x20, 0x02]),
    MSG_ID_CC_ACCEL_READ      : new Buffer([0x20, 0x10]),
    MSG_ID_CC_ACCEL_READ_RSP  : new Buffer([0x20, 0x90]),
    MSG_ID_AR_SET_POWER       : new Buffer([0x30, 0x00]),
    MSG_ID_AR_GET_CONFIG      : new Buffer([0x30, 0x06]),
    MSG_ID_DB_LOOPBACK        : new Buffer([0xFE, 0x00]),
    MSG_ID_DB_COUNTER         : new Buffer([0xFE, 0x01]),
};


noble.startScanning([], true);

noble.on('discover', function(peripheral) {
    console.log(peripheral.uuid + ' ' + peripheral.advertisement.localName + ' ' + peripheral.rssi);
    if (peripheral.uuid === uuid && peripheral.rssi > rrsiThreshold && state !== 'writing' && zone === 'outside'){  
        //zone = 'inside'; //coming this for debuging. It will always trigger the proximity threshold
        noble.stopScanning();

        // Write to Bean Serial Characteritic to change on-board LED
        var randomColor = new Buffer([getRandomInt(0,64),getRandomInt(0,255),getRandomInt(0,255)]);
        var randomColorBuffer = getBuffer(commands.MSG_ID_CC_LED_WRITE_ALL, randomColor);
        writeBeanCharacteristic(peripheral, serviceUUIDs[0], characteristicUUIDs[0], randomColorBuffer);

        //Write to Scracth 1 Characteritic
        // var charabuffer = new Buffer([5]);
        // writeBeanCharacteristic(peripheral, serviceUUIDs[1], characteristicUUIDs[1], charabuffer);

    }else if (peripheral.uuid == uuid && peripheral.rssi < rrsiThreshold ){
        zone = 'outside';
    }

});

function writeBeanCharacteristic(peripheral, serviceUUID, characteristicUUID, buffer){
    state = 'writing';
    currentPeripheral = peripheral;
    var serviceUUIDs = [serviceUUID];
    var characteristicUUIDs = [characteristicUUID];

    try{
    currentPeripheral.connect(function(error) {
            currentPeripheral.discoverSomeServicesAndCharacteristics(serviceUUIDs, characteristicUUIDs, function(error, services, characteristics){
                var service = services[0];
                var characteristic = characteristics[0];
                console.log('Writing to ' + currentPeripheral.uuid + ' (' + currentPeripheral.advertisement.localName + ')');
                characteristic.write(buffer, false, function(error) {
                    disconnectCurrentPeripheral();
                });

      });
    });
    }catch(Exception){
        console.log('Exception ' + Exception);
        writeBeanSerial(peripheral, serviceUUIDs, characteristicUUIDs, buffer);
    }
}

function getBuffer(cmdBuffer,payloadBuffer){

    //size buffer contains size of(cmdBuffer, and payloadBuffer) and a reserved byte set to 0
    var sizeBuffer = new Buffer(2);
    sizeBuffer.writeUInt8(cmdBuffer.length + payloadBuffer.length,0);
    sizeBuffer.writeUInt8(0,1);

    //GST (Gatt Serial Transport) contains sizeBuffer, cmdBuffer, and payloadBuffer
    var gstBuffer = Buffer.concat([sizeBuffer,cmdBuffer,payloadBuffer]);

    var crcString = crc.crc16ccitt(gstBuffer);
    var crc16Buffer = new Buffer(crcString, 'hex');

    //GATT contains sequence header, gstBuffer and crc166
    var gattBuffer = new Buffer(1 + gstBuffer.length + crc16Buffer.length);

    var header = (((this.count++ * 0x20) | 0x80) & 0xff);
    gattBuffer[0]=header;

    gstBuffer.copy(gattBuffer,1,0); //copy gstBuffer into gatt shifted right 1

    //swap 2 crc bytes and add to end of gatt
    gattBuffer[gattBuffer.length-2]=crc16Buffer[1];
    gattBuffer[gattBuffer.length-1]=crc16Buffer[0];

    return gattBuffer;
}



function disconnectCurrentPeripheral(){
	currentPeripheral.disconnect();
	console.log( currentPeripheral.advertisement.localName + ' disconnected');
	currentPeripheral = null;
	noble.startScanning([], true);
	state = 'scanning';
}

var getRandomInt = function(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
};

// Handle clean exit event
process.stdin.resume();//so the program will not close instantly
function exitHandler(options, err) {
    console.log('stopScanning & exit');
    if (currentPeripheral != null){
    	currentPeripheral.disconnect();
	}
    noble.stopScanning();
    process.exit();
}
// catches ctrl+c event
process.on('SIGINT', exitHandler.bind(null, {exit:true}));
