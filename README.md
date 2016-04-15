# 关于 senzflow-sdk.js

senzflow-sdk.js是 `senzflow.io` 提供的`node.js`平台网关设备开发SDK. 

# 安装

    npm install senzflow-sdk.js --save

# 如何使用

## 前提条件

使用该SDK需要先开通`senzflow.io`开发者帐号, 并创建和下载数字证书.
请参考[Getting Started](www.senzflow.io/docs/getting-started)

## 创建设备

### 设备选项

```
var options = {
    clientId: "MY-DEVICE-ID",
    caPath: "path/to/ca.pem",
    keyPath: "path/to/key.pem",
    certPath: "path/to/cert.pem",
    meta: {
        model: "model-of-device",
        name: "name-of-device",
        desc: "detailed descriptions ..."
    }
}
```
    
### 创建设备

```
var Device = require("senzflow-sdk.js").Device;
var myDevice = new Device(options)
```

设备将自动连接. 开发者在senzflow.io的设备管理界面可以查看到`identity`为*MY-DEVICE-ID*的设备. 
当设备需要接入下级节点时, 可以*接入更多节点*

### 接入更多节点

设备通过`nodeOnline`来创建下级节点.

```
    myDevice.nodeOnline("node1", {
        model: "model-of-node1",
        name: "name-of-node1",
        desc: "detailed description",
    })
```

上述API将生成节点*node1*, 在senzflow.io控制台可以看到节点在线.
相应地, 设备可以通过`nodeOffline`来使节点离线.

```
myDevice.nodeOffline("node1")
```

<small>注: `nodeOffline` 只将节点状态置为*离线*, 不会*删除*节点.</small>

### 发布数据

**采集数据**

senzflow.io推荐数据用`json`格式表达, 例如:

```
var myEnvMeasurement = {
    temperature: 20,
    humidity: 70
}
```

**发布到`数据流`**

设备将采集的数据（或者称为一个`event`）被发布到一个`数据流`. 例如: “env-measurements”:

```
myDevice.publishEvent({
    name: "env-measurements"
    content: myEnvMeasurement
})
```

**代表节点发布数据**

当设备需要代表节点“node1”要发布上述事件时, 设置`node`参数即可:

```
myDevice.publishEvent({
    node: "node1",
    name: "env-measurements"
    content: myEnvMeasurement
})
```

<small>注: 设备代表自己发送事件时, `node`参数省略</small>

**更多选项**

_QoS选择_

senzflow.io支持3种QoS级别:
  * `QoS-0`（At Most Once) 异常网络环境下会丢数据, 但是具有最高吞吐率
  * `QoS-1`（At Least Once) 数据不会丢失, 但是可能重复, 吞吐率适中, 适应大部分应用场景. 是senzflow默认选择的QoS基本
  * `QoS-2`（Exactly Once) 数据不会丢失, 也不会重复, 低吞吐率. 适应不能容忍数据重发的场景

示例: 以`QoS-0`发布数据

```
myDevice.publishEvent({
    name: "env-measurements"
    content: myEnvMeasurement,
    qos: 0
})
```

_回调发布结果_

`publishEvent`支持一个回调函数, app可以通过回调函数检查发布结果:

```
myDevice.publishEvent({
    name: "env-measurements"
    content: myEnvMeasurement,
}, function(err) {
    if (err) {
        console.error("error in publish:", err)
    }
})
```
