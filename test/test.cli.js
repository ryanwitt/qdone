/* eslint-env mocha */

const chai = require('chai')
// const exec = require('child_process').exec
const packageJson = require('../package.json')
const sinon = require('sinon')
const chalk = require('chalk')
const AWS = require('aws-sdk-mock')
// const mockStdin = require('mock-stdin')

const expect = chai.expect
chai.should()

delete process.env.AWS_ACCESS_KEY_ID
delete process.env.AWS_SECRET_ACCESS_KEY

var sandbox
beforeEach(function () {
  sandbox = sinon.sandbox.create()
  sandbox.stub(process.stdout, 'write')
  sandbox.stub(process.stderr, 'write')
})

afterEach(function () {
  sandbox.restore()
  AWS.restore()
})

function cliTest (command, success, failure) {
  const cli = require('../src/cli')
  const qrlCache = require('../src/qrlCache')
  function sandboxRestore (value) {
    sandbox.restore()
    qrlCache.clear()
    return value
  }
  return function (done) {
    cli
      .run(command)
      .then(function (result) {
        success = success || (result => result)
        const stdout = chalk.stripColor(process.stdout.write.args.reduce((a, b) => a + b, ''))
        const stderr = chalk.stripColor(process.stderr.write.args.reduce((a, b) => a + b, ''))
        return success(result, stdout, stderr)
      })
      .catch(function (err) {
        failure = failure || (err => { throw err })
        const stdout = chalk.stripColor(process.stdout.write.args.reduce((a, b) => a + b, ''))
        const stderr = chalk.stripColor(process.stderr.write.args.reduce((a, b) => a + b, ''))
        return failure(err, stdout, stderr)
      })
      .then(sandboxRestore)
      .catch(sandboxRestore)
      .then(done)
      .catch(done)
  }
}

describe('cli', function () {
  // Root command
  describe('qdone', function () {
    it('should print usage and exit 0',
      cliTest([], function (result, stdout, stderr) {
        expect(stdout).to.contain('usage: ')
      }))
  })

  describe('qdone --help', function () {
    it('should print usage and exit 0',
      cliTest(['--help'], function (result, stdout, stderr) {
        expect(stdout).to.contain('usage: ')
      }))
  })

  describe('qdone --version', function () {
    it('should print package.json version and exit 0',
      cliTest(['--version'], function (result, stdout, stderr) {
        expect(stdout).to.contain(packageJson.version)
      }))
  })

  describe('qdone --some-invalid-option', function () {
    it('should print usage and exit 1',
      cliTest(['--some-invalid-option'], null, function (err, stdout, stderr) {
        expect(stdout).to.contain('usage: ')
        expect(err).to.be.an('error')
      }))
  })

  // Enqueue
  describe('qdone enqueue', function () {
    it('should print usage and exit 1 with error',
      cliTest(['enqueue'], null, function (err, stdout, stderr) {
        expect(stdout).to.contain('usage: ')
        expect(stderr).to.contain('<queue>')
        expect(err).to.be.an('error')
      }))
  })

  describe('qdone enqueue --help', function () {
    it('should print usage and exit 0',
      cliTest(['enqueue', '--help'], function (result, stdout, stderr) {
        expect(stdout).to.contain('usage: ')
        expect(stdout).to.contain('enqueue')
      }))
  })

  describe('qdone enqueue onlyQueue', function () {
    it('should print usage and exit 1 with error',
      cliTest(['enqueue', 'onlyQueue'], null, function (err, stdout, stderr) {
        expect(stdout).to.contain('usage: ')
        expect(stderr).to.contain('<queue>')
        expect(err).to.be.an('error')
      }))
  })

  describe('qdone enqueue testQueue true # (with no credentials)', function () {
    before(function () {
      AWS.mock('SQS', 'getQueueUrl', function (params, callback) {
        const err = new Error('Access to the resource https://sqs.us-east-1.amazonaws.com/ is denied.')
        err.code = 'AccessDenied'
        callback(err)
      })
    })
    it('should print usage and exit 1 with error',
      cliTest(['enqueue', 'testQueue', 'true'], null, function (err, stdout, stderr) {
        expect(stdout).to.contain('You must provide')
        expect(stderr).to.contain('Access to the resource https://sqs.us-east-1.amazonaws.com/ is denied.')
        expect(err).to.be.an('error')
      }))
  })

  describe('qdone enqueue testQueue true # (queue exists)', function () {
    before(function () {
      AWS.mock('SQS', 'getQueueUrl', function (params, callback) {
        callback(null, {QueueUrl: `https://q.amazonaws.com/123456789101/${params.QueueName}`})
      })
      AWS.mock('SQS', 'sendMessage', function (params, callback) {
        callback(null, {
          MD5OfMessageAttributes: '00484c68...59e48f06',
          MD5OfMessageBody: '51b0a325...39163aa0',
          MessageId: 'da68f62c-0c07-4bee-bf5f-7e856EXAMPLE'
        })
      })
    })
    it('should print id of enqueued message and exit 0',
      cliTest(['enqueue', 'testQueue', 'true'], function (result, stdout, stderr) {
        expect(stderr).to.contain('Enqueued job da68f62c-0c07-4bee-bf5f-7e856EXAMPLE')
      }))
  })

  describe('qdone enqueue testQueue true # (queue does not exist)', function () {
    before(function () {
      AWS.mock('SQS', 'getQueueUrl', function (params, callback) {
        const err = new Error('Queue does not exist.')
        err.code = 'AWS.SimpleQueueService.NonExistentQueue'
        callback(err)
      })
      AWS.mock('SQS', 'createQueue', function (params, callback) {
        callback(null, {QueueUrl: `https://q.amazonaws.com/123456789101/${params.QueueName}`})
      })
      AWS.mock('SQS', 'getQueueAttributes', function (params, callback) {
        callback(null, {
          Attributes: {
            ApproximateNumberOfMessages: '0',
            ApproximateNumberOfMessagesDelayed: '0',
            ApproximateNumberOfMessagesNotVisible: '0',
            CreatedTimestamp: '1442426968',
            DelaySeconds: '0',
            LastModifiedTimestamp: '1442426968',
            MaximumMessageSize: '262144',
            MessageRetentionPeriod: '345600',
            QueueArn: 'arn:aws:sqs:us-east-1:80398EXAMPLE:MyNewQueue',
            ReceiveMessageWaitTimeSeconds: '0',
            RedrivePolicy: `{'deadLetterTargetArn':'arn:aws:sqs:us-east-1:80398EXAMPLE:${params.QueueName}','maxReceiveCount':1000}`,
            VisibilityTimeout: '30'
          }
        })
      })
      AWS.mock('SQS', 'sendMessage', function (params, callback) {
        callback(null, {
          MD5OfMessageAttributes: '00484c68...59e48f06',
          MD5OfMessageBody: '51b0a325...39163aa0',
          MessageId: 'da68f62c-0c07-4bee-bf5f-7e856EXAMPLE'
        })
      })
    })
    it('should create queues, print the id of enqueued message and exit 0',
      cliTest(['enqueue', 'testQueue', 'true'], function (result, stdout, stderr) {
        expect(stderr).to.contain('Creating fail queue testQueue_failed')
        expect(stderr).to.contain('Looking up attributes for https://q.amazonaws.com/123456789101/qdone_testQueue_failed')
        expect(stderr).to.contain('Creating queue testQueue')
        expect(stderr).to.contain('Enqueued job da68f62c-0c07-4bee-bf5f-7e856EXAMPLE')
      }))
  })

  // Enqueue batch
  describe('qdone enqueue-batch', function () {
    it('should print usage and exit 1 with error',
      cliTest(['enqueue-batch'], null, function (err, stdout, stderr) {
        expect(stdout).to.contain('usage: ')
        expect(stderr).to.contain('<file>')
        expect(err).to.be.an('error')
      }))
  })

  describe('qdone enqueue-batch --help', function () {
    it('should print usage and exit 0',
      cliTest(['enqueue-batch', '--help'], function (result, stdout, stderr) {
        expect(stdout).to.contain('usage: ')
        expect(stdout).to.contain('enqueue-batch')
      }))
  })

  describe('qdone enqueue-batch some_non_existant_file', function () {
    it('should exit 1 with error',
      cliTest(['enqueue-batch', 'some_non_existant_file'], null, function (err, stdout, stderr) {
        expect(stderr).to.contain('no such file or directory')
        expect(err).to.be.an('error')
      }))
  })

  describe('qdone enqueue-batch test/fixtures/test-unique01-x24.batch # (with no credentials)', function () {
    before(function () {
      AWS.mock('SQS', 'getQueueUrl', function (params, callback) {
        const err = new Error('Access to the resource https://sqs.us-east-1.amazonaws.com/ is denied.')
        err.code = 'AccessDenied'
        callback(err)
      })
    })
    it('should print usage and exit 1 with error',
      cliTest(['enqueue-batch', 'test/fixtures/test-unique01-x24.batch'], null, function (err, stdout, stderr) {
        expect(stdout).to.contain('You must provide')
        expect(stderr).to.contain('Access to the resource https://sqs.us-east-1.amazonaws.com/ is denied.')
        expect(err).to.be.an('error')
      }))
  })

  describe('qdone enqueue-batch test/fixtures/test-unique01-x24.batch # (queue exists)', function () {
    before(function () {
      AWS.mock('SQS', 'getQueueUrl', function (params, callback) {
        callback(null, {QueueUrl: `https://q.amazonaws.com/123456789101/${params.QueueName}`})
      })
      var messageId = 0
      AWS.mock('SQS', 'sendMessageBatch', function (params, callback) {
        callback(null, {
          Failed: [],
          Successful: params.Entries.map(message => ({
            MD5OfMessageAttributes: '00484c68...59e48f06',
            MD5OfMessageBody: '51b0a325...39163aa0',
            MessageId: 'da68f62c-0c07-4bee-bf5f-56EXAMPLE-' + messageId++
          }))
        })
      })
    })
    it('should print id of enqueued messages, use 3 requests, print total count and exit 0',
      cliTest(['enqueue-batch', 'test/fixtures/test-unique01-x24.batch'], function (result, stdout, stderr) {
        for (var messageId = 0; messageId < 24; messageId++) {
          expect(stderr).to.contain('Enqueued job da68f62c-0c07-4bee-bf5f-56EXAMPLE-' + messageId)
        }
        expect(stderr).to.contain('Enqueued 24 jobs')
        expect(stderr).to.contain('request 1')
        expect(stderr).to.contain('request 2')
        expect(stderr).to.contain('request 3')
      }))
  })

  describe('qdone enqueue-batch test/fixtures/test-unique01-x24.batch # (queue does not exist)', function () {
    before(function () {
      AWS.mock('SQS', 'getQueueUrl', function (params, callback) {
        const err = new Error('Queue does not exist.')
        err.code = 'AWS.SimpleQueueService.NonExistentQueue'
        callback(err)
      })
      AWS.mock('SQS', 'createQueue', function (params, callback) {
        callback(null, {QueueUrl: `https://q.amazonaws.com/123456789101/${params.QueueName}`})
      })
      AWS.mock('SQS', 'getQueueAttributes', function (params, callback) {
        callback(null, {
          Attributes: {
            ApproximateNumberOfMessages: '0',
            ApproximateNumberOfMessagesDelayed: '0',
            ApproximateNumberOfMessagesNotVisible: '0',
            CreatedTimestamp: '1442426968',
            DelaySeconds: '0',
            LastModifiedTimestamp: '1442426968',
            MaximumMessageSize: '262144',
            MessageRetentionPeriod: '345600',
            QueueArn: 'arn:aws:sqs:us-east-1:80398EXAMPLE:MyNewQueue',
            ReceiveMessageWaitTimeSeconds: '0',
            RedrivePolicy: `{'deadLetterTargetArn':'arn:aws:sqs:us-east-1:80398EXAMPLE:${params.QueueName}','maxReceiveCount':1000}`,
            VisibilityTimeout: '30'
          }
        })
      })
      var messageId = 0
      AWS.mock('SQS', 'sendMessageBatch', function (params, callback) {
        callback(null, {
          Failed: [],
          Successful: params.Entries.map(message => ({
            MD5OfMessageAttributes: '00484c68...59e48f06',
            MD5OfMessageBody: '51b0a325...39163aa0',
            MessageId: 'da68f62c-0c07-4bee-bf5f-56EXAMPLE-' + messageId++
          }))
        })
      })
    })
    it('should create queues, print ids of enqueued messages, use 3 requests, print total count and exit 0',
      cliTest(['enqueue-batch', 'test/fixtures/test-unique01-x24.batch'], function (result, stdout, stderr) {
        expect(stderr).to.contain('Creating fail queue test_failed')
        expect(stderr).to.contain('Looking up attributes for https://q.amazonaws.com/123456789101/qdone_test_failed')
        expect(stderr).to.contain('Creating queue test')
        for (var messageId = 0; messageId < 24; messageId++) {
          expect(stderr).to.contain('Enqueued job da68f62c-0c07-4bee-bf5f-56EXAMPLE-' + messageId)
        }
        expect(stderr).to.contain('Enqueued 24 jobs')
        expect(stderr).to.contain('request 1')
        expect(stderr).to.contain('request 2')
        expect(stderr).to.contain('request 3')
      }))
  })

  describe('qdone enqueue-batch test/fixtures/test-unique{01-x24.batch,02-x24.batch,24-x24.batch,24-x240.batch} # (ensemble fixtures, queue exists)', function () {
    before(function () {
      AWS.mock('SQS', 'getQueueUrl', function (params, callback) {
        callback(null, {QueueUrl: `https://q.amazonaws.com/123456789101/${params.QueueName}`})
      })
      var messageId = 0
      AWS.mock('SQS', 'sendMessageBatch', function (params, callback) {
        callback(null, {
          Failed: [],
          Successful: params.Entries.map(message => ({
            MD5OfMessageAttributes: '00484c68...59e48f06',
            MD5OfMessageBody: '51b0a325...39163aa0',
            MessageId: 'da68f62c-0c07-4bee-bf5f-56EXAMPLE-' + messageId++
          }))
        })
      })
    })
    it('should print id of enqueued messages, use 53 requests, print total count and exit 0',
      cliTest([
        'enqueue-batch',
        'test/fixtures/test-unique01-x24.batch',
        'test/fixtures/test-unique02-x24.batch',
        'test/fixtures/test-unique24-x24.batch',
        'test/fixtures/test-unique24-x240.batch'
      ], function (result, stdout, stderr) {
        for (var messageId = 0; messageId < 312; messageId++) {
          expect(stderr).to.contain('Enqueued job da68f62c-0c07-4bee-bf5f-56EXAMPLE-' + messageId)
        }
        expect(stderr).to.contain('Enqueued 312 jobs')
        expect(stderr).to.contain('request 1')
        expect(stderr).to.contain('request 2')
        expect(stderr).to.contain('request 53')
      }))
  })

  // Worker
  describe('qdone worker', function () {
    it('should print usage and exit 1 with error',
      cliTest(['worker'], null, function (err, stdout, stderr) {
        expect(stdout).to.contain('usage: ')
        expect(stderr).to.contain('<queue>')
        expect(err).to.be.an('error')
      }))
  })

  describe('qdone worker --help', function () {
    it('should print usage and exit 0',
      cliTest(['worker', '--help'], function (result, stdout, stderr) {
        expect(stdout).to.contain('usage: ')
        expect(stdout).to.contain('worker')
      }))
  })

  describe('qdone worker some_non_existant_queue', function () {
    before(function () {
      AWS.mock('SQS', 'getQueueUrl', function (params, callback) {
        const err = new Error('Queue does not exist.')
        err.code = 'AWS.SimpleQueueService.NonExistentQueue'
        callback(err)
      })
    })
    it('should exit 1 with error',
      cliTest(['worker', 'some_non_existant_queue'], null, function (err, stdout, stderr) {
        expect(stderr).to.contain('AWS.SimpleQueueService.NonExistentQueue')
        expect(err).to.be.an('error')
      }))
  })

  describe('qdone worker test --drain', function () {
    before(function () {
      AWS.mock('SQS', 'getQueueUrl', function (params, callback) {
        callback(null, {QueueUrl: `https://q.amazonaws.com/123456789101/${params.QueueName}`})
      })
      AWS.mock('SQS', 'listQueues', function (params, callback) {
        callback(null, {QueueUrls: [`https://q.amazonaws.com/123456789101/${params.QueueName}`]})
      })
      AWS.mock('SQS', 'receiveMessage', function (params, callback) {
        callback(null, { Messages: [
          { MessageId: 'da68f62c-0c07-4bee-bf5f-7e856EXAMPLE', Body: 'true', ReceiptHandle: 'AQEBzbVv...fqNzFw==' }
        ] })
      })
      AWS.mock('SQS', 'deleteMessage', function (params, callback) {
        callback(null, {})
      })
    })
    it('should execute the job successfully and exit 0',
      cliTest(['worker', 'test', '--drain'], function (result, stdout, stderr) {
        expect(stderr).to.contain('Looking for work on test')
        expect(stderr).to.contain('Found job da68f62c-0c07-4bee-bf5f-7e856EXAMPLE')
        expect(stderr).to.contain('SUCCESS')
      }))
  })

  describe('qdone worker test --wait-time 15', function () {
    it('should call worker listen loop with a wait time of 15', function () {
      const cli = require('../src/cli')
      const worker = require('../src/worker')
      sandbox.stub(worker, 'listen', _ => Promise.resolve())
      const result = cli.run(['worker', 'test', '--wait-time', '15'])
      expect(worker.listen.calledWithMatch('testy', sinon.match.has('wait-time', 15)))
      return result.then(_ => sandbox.restore())
    })
  })
})
