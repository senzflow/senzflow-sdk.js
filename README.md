# SDK

senzflow-sdk.js是 `senzflow.io` 提供的`node.js`平台网关设备开发SDK. 

# 安装

    npm install senzflow-sdk.js --save
    

# 如何使用

## 前提条件

__使用该SDK需要先__

* 开通`senzflow.io`帐号
* 在云端创建和下载数字证书
* 在云端添加网关，定义网关ID`(GATEWAY-ID)`
* 在云端添加设备，定义设备ID`(DEVICE-ID)`
* 在云端添加数据流，定义数据流ID`(STREAM-ID)`
* 在网关建立nodejs运行环境
  
-------------------------------------------------
请参考[Getting Started](/resource/gettingstarted)



## 建立连接

首先创建网关对象

        var Gateway = require("senzflow-sdk.js").Device;
        var myGateway = new Gateway(options);

`options`为网关选项，定义如下

1. 如果网关接入认证方式为*证书*

        var options = {
            clientId : "GATEWAY-ID",          //GATEWAY-ID云端定义
            caPath   : "ca.pem",              //证书从云端下载
            keyPath  : "key.pem",
            certPath : "cert.pem",
        }


2. 如果网关接入认证方式为*Token*

        var options = {
            clientId : "GATEWAY-ID",          
            caPath   : "ca.pem",              
            auth     : "VENDER-ID:TOKEN"   //VENDER-ID:TOKEN云端定义
        }
或
        
        var options = {
            clientId : "GATEWAY-ID",          
            auth     : "VENDER-ID:TOKEN"
        }


当网关对象创建后，网关将自动和云端建立连接，下面代码可在控制台观察连接是否成功。

        myGateway.on("connect", function() { console.log("device connected.") });
        myGateway.on("error", function(error) { console.error("Exception here >>>", error.stack, error) });



## 准备数据

网关采集的数据被称为数据点。发送的数据被称为数据流。一个数据流包含多个数据点。 
数据流和数据点的定义在云端`添加数据流`的时候已经确定。

网关侧数据流定义默认使用`json`格式，例如

        var myDataStream = {
                DataPoint1: value1,          //数据点名云端定义
                DataPoint2: value2，         
                ...
                $time: timestamp,
            }

* 注意：数据点的名字必须和云端一致，否则云端无法识别。`$time`是系统默认的时间戳的名字。


## 发送数据

发送数据的消息或事件定义如下：

        var myEvent = {
            name     : STREAM-ID,              //STREAM-ID云端定义
            node     : DEVICE-ID,              //DEVICE-ID云端定义  
            Qos      : [取值范围0-2,系统默认为1]，
            payload  : myDataStream         
        }

_QoS选择_：

  + `QoS-0`（At Most Once) 异常网络环境下会丢数据, 但是具有最高吞吐率。
  + `QoS-1`（At Least Once) 数据不会丢失, 但是可能重复, 吞吐率适中, 适应大部分应用场景。 
  + `QoS-2`（Exactly Once) 数据不会丢失, 也不会重复, 低吞吐率. 适应不能容忍数据重发的场景。


下面代码可将网关数据发送到云端:

        myGateway.publishEvent( myEvent,function(err){
            if (err) {console.error("error in publishing:", err)}})



# 获得帮助

* 进一步了解 [senzflow docs](/resource)
* 欢迎 [贡献代码](https://github.com/senzflow/senzflow-sdk.js/pulls)
* 需要业务上的帮助, 请[联系我们](/contacts)